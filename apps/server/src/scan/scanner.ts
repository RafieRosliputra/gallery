import path from 'node:path';
import type { Pool } from 'pg';
import { derivativeKey } from './deriv-key.js';
import { readPhotoMetadata } from './exif.js';
import { imageMimeType, walkSourceFiles } from './files.js';
import { assertOutsideSource, toPosixPath } from './paths.js';
import { removeDerivativeDirectory } from '../thumbs/generate.js';
import { mergeMovedAssets, recordFolderMoves } from './moves.js';

export interface ScanStats {
  scanned: number;
  added: number;
  changed: number;
  unchanged: number;
  deleted: number;
  /** Files recognised as moved (same name, size and mtime at a new path). */
  moved: number;
  errors: number;
  durationMs: number;
}

export interface ScanOptions {
  pool: Pool;
  sourceRoot: string;
  dataDir: string;
  /** Directory names skipped at any depth. Defaults to SCAN_EXCLUDE. */
  excludeDirectories?: string[];
  /** Called with asset ids that need a fresh thumbnail. */
  onAssetsChanged?: (assetIds: string[]) => Promise<void>;
  logger?: { info: (message: string) => void; error: (message: string) => void };
}

interface ExistingAsset {
  id: string;
  size: number;
  mtimeMs: number;
  deletedAt: Date | null;
  derivKey: string;
}

interface PendingAsset {
  path: string;
  folderId: string;
  camera: string | null;
  size: number;
  mtimeMs: number;
  derivKey: string;
  mime: string;
  takenAt: Date;
  width: number | null;
  height: number | null;
  oldDerivKey: string | null;
}

const UPSERT_BATCH_SIZE = 100;

/** CLI, periodic timer and admin rescan all serialize on this Postgres lock. */
export const SCAN_LOCK_NAME = 'johorstudio-gallery:scan';

/**
 * One incremental pass over SOURCE_ROOT. Read-only against the source tree:
 * the only writes go to Postgres and DATA_DIR/thumbs.
 */
export async function scanLibrary(options: ScanOptions): Promise<ScanStats> {
  const lock = await options.pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [SCAN_LOCK_NAME]);
    return await scanLibraryLocked(options);
  } finally {
    await lock
      .query('SELECT pg_advisory_unlock(hashtext($1))', [SCAN_LOCK_NAME])
      .catch((error: unknown) => options.logger?.error(`scan unlock: ${(error as Error).message}`));
    lock.release();
  }
}

async function scanLibraryLocked(options: ScanOptions): Promise<ScanStats> {
  const { pool, sourceRoot, dataDir } = options;
  const startedAt = new Date();
  assertOutsideSource(sourceRoot, dataDir);

  const run = await pool.query<{ id: string }>(
    'INSERT INTO scan_run (started_at) VALUES ($1) RETURNING id',
    [startedAt],
  );
  const runId = run.rows[0]?.id;
  if (!runId) throw new Error('failed to create scan_run row');

  const stats: ScanStats = {
    scanned: 0,
    added: 0,
    changed: 0,
    unchanged: 0,
    deleted: 0,
    moved: 0,
    errors: 0,
    durationMs: 0,
  };

  const existing = await loadExistingAssets(pool);
  const seen = new Set<string>();
  const changedIds: string[] = [];
  const folderIds = new Map<string, string>();
  const pending: PendingAsset[] = [];
  const oldDerivKeys: string[] = [];
  const walkErrors: { path: string; message: string }[] = [];

  const recordError = async (source: string, message: string, assetId?: string): Promise<void> => {
    stats.errors += 1;
    options.logger?.error(`${source}: ${message}`);
    await pool
      .query('INSERT INTO job_error (source, message, asset_id) VALUES ($1, $2, $3)', [
        source,
        message.slice(0, 2_000),
        assetId ?? null,
      ])
      .catch(() => undefined);
  };

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const rows = pending.splice(0, pending.length);
    const returned = await upsertAssets(pool, rows);
    const oldByPath = new Map(rows.map((row) => [row.path, row.oldDerivKey]));
    for (const row of returned) {
      changedIds.push(row.id);
      const oldKey = oldByPath.get(row.path);
      if (oldKey && oldKey !== row.derivKey) oldDerivKeys.push(oldKey);
    }
  };

  try {
    for await (const file of walkSourceFiles(sourceRoot, {
      ...(options.excludeDirectories ? { excludeDirectories: options.excludeDirectories } : {}),
      onError: (absolutePath, error) => {
        walkErrors.push({ path: absolutePath, message: (error as Error).message });
      },
    })) {
      stats.scanned += 1;
      seen.add(file.relativePath);
      const previous = existing.get(file.relativePath);

      if (previous && previous.deletedAt === null && previous.size === file.size && previous.mtimeMs === file.mtimeMs) {
        stats.unchanged += 1;
        continue;
      }

      if (previous && previous.deletedAt !== null && previous.size === file.size && previous.mtimeMs === file.mtimeMs) {
        await pool.query('UPDATE asset SET deleted_at = NULL, scanned_at = now() WHERE id = $1', [previous.id]);
        changedIds.push(previous.id);
        stats.changed += 1;
        continue;
      }

      try {
        const metadata = await readPhotoMetadata(file.absolutePath, file.mtimeMs);
        const folderId = await ensureFolder(pool, folderIds, path.posix.dirname(file.relativePath));
        pending.push({
          path: file.relativePath,
          folderId,
          camera: file.camera,
          size: file.size,
          mtimeMs: file.mtimeMs,
          derivKey: derivativeKey(file.relativePath, file.size, file.mtimeMs),
          mime: imageMimeType(file.relativePath) ?? 'application/octet-stream',
          takenAt: metadata.takenAt,
          width: metadata.width,
          height: metadata.height,
          oldDerivKey: previous?.derivKey ?? null,
        });
        if (previous) stats.changed += 1;
        else stats.added += 1;
        if (pending.length >= UPSERT_BATCH_SIZE) await flush();
      } catch (error) {
        await recordError('scan', `${file.relativePath}: ${(error as Error).message}`, previous?.id);
      }
    }

    for (const error of walkErrors) {
      await recordError('scan', `${error.path}: ${error.message}`);
    }

    await flush();

    // Moved files keep their asset row (id, thumbnails, favourites).
    const recent = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const missingIds = [...existing.entries()]
      .filter(([assetPath, asset]) => !seen.has(assetPath) && (asset.deletedAt === null || asset.deletedAt.getTime() > recent))
      .map(([, asset]) => asset.id);
    try {
      const merged = await mergeMovedAssets(pool, missingIds);
      if (merged.length > 0) {
        stats.moved = merged.length;
        const dropped = new Set(merged.map((move) => move.newId));
        const kept = changedIds.filter((id) => !dropped.has(id));
        // Rows inserted this pass that turned out to be moves are not "added".
        stats.added = Math.max(0, stats.added - (changedIds.length - kept.length));
        changedIds.length = 0;
        changedIds.push(...kept);
        for (const move of merged) oldDerivKeys.push(move.droppedKey);
        const folders = await recordFolderMoves(pool, merged);
        for (const folder of folders) {
          options.logger?.info(
            `scan: folder moved ${folder.from} -> ${folder.to} (${folder.assets} files, ${folder.albums} album rules)`,
          );
        }
      }
    } catch (error) {
      await recordError('scan', `move detection: ${(error as Error).message}`);
    }

    const deleted = await pool.query(
      `UPDATE asset SET deleted_at = now(), scanned_at = now()
       WHERE deleted_at IS NULL AND path <> ALL($1::text[])`,
      [[...seen]],
    );
    stats.deleted = deleted.rowCount ?? 0;

    for (const oldKey of oldDerivKeys) {
      await removeDerivativeDirectory(dataDir, oldKey).catch((error: unknown) => {
        options.logger?.error(`thumb cleanup ${oldKey}: ${(error as Error).message}`);
      });
    }

    if (changedIds.length > 0 && options.onAssetsChanged) await options.onAssetsChanged(changedIds);

    return stats;
  } finally {
    stats.durationMs = Date.now() - startedAt.getTime();
    await pool
      .query(
        `UPDATE scan_run SET finished_at = now(), scanned = $2, added = $3, changed = $4,
           unchanged = $5, deleted = $6, errors = $7 WHERE id = $1`,
        [runId, stats.scanned, stats.added, stats.changed, stats.unchanged, stats.deleted, stats.errors],
      )
      .catch((error: unknown) => options.logger?.error(`scan_run update: ${(error as Error).message}`));
    options.logger?.info(
      `scan: ${stats.scanned} files, ${stats.added} added, ${stats.changed} changed, ` +
        `${stats.unchanged} unchanged, ${stats.deleted} deleted, ${stats.moved} moved, ${stats.errors} errors in ${stats.durationMs}ms`,
    );
  }
}

async function loadExistingAssets(pool: Pool): Promise<Map<string, ExistingAsset>> {
  const { rows } = await pool.query<{
    id: string;
    path: string;
    size: string;
    mtime: Date;
    deleted_at: Date | null;
    deriv_key: string;
  }>('SELECT id, path, size, mtime, deleted_at, deriv_key FROM asset');
  return new Map(
    rows.map((row) => [
      row.path,
      {
        id: row.id,
        size: Number(row.size),
        mtimeMs: row.mtime.getTime(),
        deletedAt: row.deleted_at,
        derivKey: row.deriv_key,
      },
    ]),
  );
}

async function ensureFolder(pool: Pool, cache: Map<string, string>, relativeDirectory: string): Promise<string> {
  const normalized = toPosixPath(relativeDirectory);
  const cached = cache.get(normalized);
  if (cached) return cached;
  const parentId = normalized === '.' ? null : await ensureFolder(pool, cache, path.posix.dirname(normalized));
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO folder (path, parent_id) VALUES ($1, $2)
     ON CONFLICT (path) DO UPDATE SET parent_id = EXCLUDED.parent_id
     RETURNING id`,
    [normalized, parentId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to upsert folder ${normalized}`);
  cache.set(normalized, id);
  return id;
}

async function upsertAssets(pool: Pool, rows: PendingAsset[]): Promise<{ id: string; path: string; derivKey: string }[]> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (const row of rows) {
    const base = values.length;
    values.push(
      row.path,
      row.folderId,
      row.camera,
      row.size,
      new Date(row.mtimeMs),
      row.derivKey,
      row.takenAt,
      row.width,
      row.height,
      row.mime,
    );
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ` +
        `$${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`,
    );
  }

  const { rows: returned } = await pool.query<{ id: string; path: string; deriv_key: string }>(
    `INSERT INTO asset (path, folder_id, camera, size, mtime, deriv_key, taken_at, w, h, mime)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (path) DO UPDATE SET
       folder_id = EXCLUDED.folder_id,
       camera = EXCLUDED.camera,
       size = EXCLUDED.size,
       mtime = EXCLUDED.mtime,
       deriv_key = EXCLUDED.deriv_key,
       taken_at = EXCLUDED.taken_at,
       w = EXCLUDED.w,
       h = EXCLUDED.h,
       mime = EXCLUDED.mime,
       deleted_at = NULL,
       thumb_ok = false,
       r2_ok = false,
       thumbhash = NULL,
       scanned_at = now()
     RETURNING id, path, deriv_key`,
    values,
  );
  return returned.map((row) => ({ id: row.id, path: row.path, derivKey: row.deriv_key }));
}
