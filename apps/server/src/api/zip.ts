import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { PassThrough } from 'node:stream';
import type { Pool } from 'pg';
import { ZipFile } from 'yazl';
import { resolveInside } from '../scan/paths.js';
import { bodyRecord, NOT_FOUND_MESSAGE, sendError } from './http.js';
import { albumFolderIds, findAlbumBySlug } from './repository.js';
import { hotPath } from './originals.js';

export interface ZipDeps {
  pool: Pool;
  dataDir: string;
  sourceRoot?: string;
}

const ZIP_BATCH_SIZE = 200;
const MAX_IDS = 10_000;

interface ZipAssetRow {
  id: string;
  path: string;
  deriv_key: string;
  mime: string;
  hot_until: Date | null;
  taken_at: Date;
}

interface ZipRequest {
  albumSlug: string;
  ids: string[] | null;
  camera: string | null;
}

function parseZipRequest(body: unknown): ZipRequest | string {
  const record = bodyRecord(body);
  if (!record) return 'Invalid request.';
  const albumSlug = record['albumSlug'];
  if (typeof albumSlug !== 'string' || albumSlug.trim() === '') return 'albumSlug is required.';

  const cam = record['cam'];
  if (cam !== undefined && cam !== null && typeof cam !== 'string') return 'Invalid cam.';
  const camera = typeof cam === 'string' && cam.trim() !== '' && cam.toLowerCase() !== 'all' ? cam.trim() : null;

  const idsRaw = record['ids'];
  let ids: string[] | null = null;
  if (idsRaw !== undefined && idsRaw !== null) {
    if (!Array.isArray(idsRaw)) return 'ids must be a list.';
    if (idsRaw.length > MAX_IDS) return `ids melebihi had ${MAX_IDS}.`;
    const parsed: string[] = [];
    for (const value of idsRaw) {
      if (typeof value !== 'string' && typeof value !== 'number') return 'Invalid ids.';
      const id = String(value);
      if (!/^\d{1,19}$/.test(id)) return 'Invalid ids.';
      parsed.push(id);
    }
    ids = parsed;
  }

  return { albumSlug: albumSlug.trim(), ids, camera };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function zipEntryName(relativePath: string, mime: string, used: Set<string>): string {
  const base = path.posix.basename(relativePath.split(path.sep).join('/'));
  const fallbackExtension = mime === 'image/webp' ? '.webp' : '.jpg';
  const safe = base === '' || base === '.' || base === '..' ? `photo${fallbackExtension}` : base;
  const extension = path.posix.extname(safe);
  const stem = extension === '' ? safe : safe.slice(0, -extension.length);
  let candidate = safe;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem} (${counter})${extension}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Streamed ZIP: rows are paged with keyset, each original is read straight from
 * hot cache or source, and bytes go directly to the HTTP response. No temp file.
 */
export function registerZipRoute(app: FastifyInstance, deps: ZipDeps): void {
  app.post('/s/api/zip', async (request, reply) => {
    const parsed = parseZipRequest(request.body);
    if (typeof parsed === 'string') return sendError(reply, 400, 'bad_request', parsed);

    const album = await findAlbumBySlug(deps.pool, parsed.albumSlug);
    if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    if (!album.allowDownload) {
      return sendError(reply, 403, 'download_disabled', 'Downloads are turned off for this album.');
    }

    const folderIds = await albumFolderIds(deps.pool, album.id);
    const zip = new ZipFile();
    const output = zip.outputStream as PassThrough;
    const used = new Set<string>();
    let cursor: { takenAt: Date; id: string } | null = null;

    reply.hijack();
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${album.slug}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    reply.raw.writeHead(200, headers);

    let aborted = false;
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) {
        aborted = true;
        output.destroy();
      }
    });

    try {
      output.pipe(reply.raw);
      zip.on('error', (error: Error) => {
        request.log.error({ err: error, album: album.slug }, 'zip stream failed');
        reply.raw.destroy(error);
      });

      while (!aborted) {
        const batch = await fetchZipBatch(deps.pool, {
          folderIds,
          camera: parsed.camera,
          ids: parsed.ids,
          cursor,
          limit: ZIP_BATCH_SIZE,
        });
        if (batch.length === 0) break;
        for (const asset of batch) {
          if (aborted) break;
          let file: string | null = null;
          if (asset.hot_until && asset.hot_until.getTime() > Date.now()) {
            const hot = hotPath(deps.dataDir, asset.deriv_key);
            if (await fileExists(hot)) file = hot;
          }
          if (!file && deps.sourceRoot) {
            try {
              file = resolveInside(deps.sourceRoot, asset.path);
            } catch {
              file = null;
            }
          }
          if (!file || !(await fileExists(file))) {
            request.log.warn({ assetId: asset.id, path: asset.path }, 'zip: original missing, skipped');
            continue;
          }
          zip.addFile(file, zipEntryName(asset.path, asset.mime, used));
        }
        const last = batch[batch.length - 1];
        cursor = last ? { takenAt: last.taken_at, id: last.id } : null;
        if (batch.length < ZIP_BATCH_SIZE) break;
      }
      if (!aborted) {
        zip.end();
        await new Promise<void>((resolve) => {
          if (reply.raw.writableFinished || reply.raw.destroyed) return resolve();
          reply.raw.once('finish', resolve);
          reply.raw.once('close', resolve);
        });
      }
    } catch (error) {
      request.log.error({ err: error, album: album.slug }, 'zip failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      reply.raw.destroy(error as Error);
    }
  });
}

interface ZipBatchOptions {
  folderIds: string[];
  camera: string | null;
  ids: string[] | null;
  cursor: { takenAt: Date; id: string } | null;
  limit: number;
}

async function fetchZipBatch(pool: Pool, options: ZipBatchOptions): Promise<ZipAssetRow[]> {
  if (options.folderIds.length === 0) return [];
  const values: unknown[] = [options.folderIds];
  const where: string[] = [
    'deleted_at IS NULL',
    'taken_at IS NOT NULL',
    'folder_id = ANY($1::bigint[])',
  ];
  if (options.camera) {
    values.push(options.camera);
    where.push(`camera = $${values.length}`);
  }
  if (options.ids) {
    values.push(options.ids);
    where.push(`id = ANY($${values.length}::bigint[])`);
  }
  if (options.cursor) {
    values.push(options.cursor.takenAt);
    const timeIndex = values.length;
    values.push(options.cursor.id);
    const idIndex = values.length;
    where.push(`(taken_at > $${timeIndex} OR (taken_at = $${timeIndex} AND id > $${idIndex}::bigint))`);
  }
  values.push(options.limit);
  const { rows } = await pool.query<ZipAssetRow>(
    `SELECT id, path, deriv_key, mime, hot_until, taken_at
     FROM asset
     WHERE ${where.join(' AND ')}
     ORDER BY taken_at ASC, id ASC
     LIMIT $${values.length}`,
    values,
  );
  return rows;
}
