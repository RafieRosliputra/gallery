import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { optionalAdmin, type AuthDeps } from '../auth/routes.js';
import { derivativeDirectory } from '../thumbs/generate.js';
import { resolveInside } from '../scan/paths.js';
import { NOT_FOUND_MESSAGE, parseBigIntId, sendError } from './http.js';
import { albumFolderIds, findAlbumBySlug, findAssetFile } from './repository.js';
import { derivativeKeyIsValid } from './urls.js';

export interface OriginalDeps {
  pool: Pool;
  auth: AuthDeps;
  dataDir: string;
  sourceRoot?: string;
}

const SCOPE_DENIED = 'Fail ini tidak dibenarkan untuk pautan ini.';
const DOWNLOAD_DENIED = 'Muat turun tidak dibenarkan untuk album ini.';

/** Hot cache path: DATA_DIR/hot/<derivKey> (phase 3 writes it). */
export function hotPath(dataDir: string, derivKey: string): string {
  return path.join(dataDir, 'hot', derivKey);
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export function registerOriginalRoutes(app: FastifyInstance, deps: OriginalDeps): void {
  app.get('/s/api/o/:assetId', async (request, reply) => {
    const rawId = (request.params as { assetId: string }).assetId;
    const assetId = parseBigIntId(rawId);
    if (!assetId) return sendError(reply, 400, 'bad_id', 'ID fail tidak sah.');

    const asset = await findAssetFile(deps.pool, assetId);
    if (!asset) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);

    const admin = await optionalAdmin(request, deps.auth);
    if (!admin) {
      const albumSlug = (request.query as Record<string, unknown> | undefined)?.['album'];
      if (typeof albumSlug !== 'string' || albumSlug === '') {
        return sendError(reply, 401, 'unauthorized', 'Sesi tidak sah atau telah tamat.');
      }
      const album = await findAlbumBySlug(deps.pool, albumSlug);
      if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      const folderIds = await albumFolderIds(deps.pool, album.id);
      if (!folderIds.includes(asset.folder_id)) return sendError(reply, 403, 'forbidden', SCOPE_DENIED);
      // A public album link is not a download link when allow_download is off.
      // Derivatives under /s/t stay public; only the original is gated. The
      // viewer's zoom (`view=1`) may still show the full-resolution file inline.
      const view = (request.query as Record<string, unknown> | undefined)?.['view'] === '1';
      if (!album.allowDownload && !view) return sendError(reply, 403, 'download_disabled', DOWNLOAD_DENIED);
    }

    let file: string | null = null;
    if (asset.hot_until && asset.hot_until.getTime() > Date.now()) {
      const hot = hotPath(deps.dataDir, asset.deriv_key);
      if (await exists(hot)) file = hot;
    }
    if (!file) {
      if (!deps.sourceRoot) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      try {
        file = resolveInside(deps.sourceRoot, asset.path);
      } catch {
        return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      }
    }

    let info;
    try {
      info = await stat(file);
    } catch {
      return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    }

    const filename = path.basename(asset.path).replace(/["\\\r\n]/g, '');
    return reply
      .header('Content-Type', asset.mime)
      .header('Content-Length', String(info.size))
      .header('Content-Disposition', `inline; filename="${filename || `photo-${asset.id}`}"`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(file));
  });

  // Local derivative fallback when the Worker misses R2. Keys are immutable.
  app.get('/s/t/:derivKey/:file', async (request, reply) => {
    const { derivKey, file } = request.params as { derivKey: string; file: string };
    if (!derivativeKeyIsValid(derivKey) || (file !== '300.webp' && file !== '1600.webp')) {
      return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    }
    const target = path.join(derivativeDirectory(deps.dataDir, derivKey), file);
    try {
      const info = await stat(target);
      if (!info.isFile()) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      return reply
        .header('Content-Type', 'image/webp')
        .header('Content-Length', String(info.size))
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(target));
    } catch {
      return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    }
  });
}
