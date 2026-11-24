import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type {
  AlbumCard,
  AlbumResponse,
  AssetLookupResponse,
  BucketResponse,
  BucketSummary,
  ClientResponse,
  ResolveResponse,
} from '@gallery/shared';
import { optionalAdmin, type AuthDeps } from '../auth/routes.js';
import { bodyRecord, NOT_FOUND_MESSAGE, parseBigIntId, parseLimit, sendError } from './http.js';
import { decodeAssetCursor, fetchAssetPage } from './assets-query.js';
import { findAlbumBySlug, findClientBySlug, findAssetFile, albumFolderIds, type AlbumRecord } from './repository.js';
import { toAssetItem } from './rows.js';
import { albumFolderView } from './album-folders.js';

export interface PublicApiDeps {
  pool: Pool;
  auth: AuthDeps;
  thumbBase: string;
  timezone: string;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function queryText(query: unknown, key: string): string | null {
  const record = bodyRecord(query);
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function registerPublicRoutes(app: FastifyInstance, deps: PublicApiDeps): void {
  app.get('/s/api/resolve/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const { rows } = await deps.pool.query<{ kind: 'client' | 'album' }>(
      'SELECT kind FROM slug_registry WHERE slug = $1',
      [slug],
    );
    const kind = rows[0]?.kind;
    if (kind === 'client') {
      const client = await findClientBySlug(deps.pool, slug);
      if (!client) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      const body: ResolveResponse = {
        kind: 'client',
        client: { id: client.id, name: client.name, slug: client.slug },
      };
      return reply.header('Cache-Control', 'no-store').send(body);
    }
    if (kind === 'album') {
      const album = await findAlbumBySlug(deps.pool, slug);
      if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      const body: ResolveResponse = {
        kind: 'album',
        album: {
          id: album.id,
          clientId: album.clientId,
          title: album.title,
          slug: album.slug,
          allowDownload: album.allowDownload,
        },
        client: { id: album.clientId, name: album.clientName, slug: album.clientSlug },
      };
      return reply.header('Cache-Control', 'no-store').send(body);
    }
    return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
  });

  app.get('/s/api/client/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const client = await findClientBySlug(deps.pool, slug);
    if (!client) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);

    const { rows } = await deps.pool.query<AlbumCardRow>(
      `WITH scope AS (
         SELECT al.id AS album_id, s.fid AS folder_id
         FROM album al CROSS JOIN LATERAL album_scope(al.id) s
         WHERE al.client_id = $1
       )
       SELECT a.id, a.client_id, a.title, a.slug, a.allow_download,
              (SELECT count(*) FROM asset x
               WHERE x.deleted_at IS NULL
                 AND x.folder_id IN (SELECT s.folder_id FROM scope s WHERE s.album_id = a.id))::int AS count,
              cover.id AS cover_id, cover.deriv_key AS cover_deriv_key,
              cover.w AS cover_w, cover.h AS cover_h, cover.taken_at AS cover_taken_at,
              cover.camera AS cover_camera, cover.thumbhash AS cover_thumbhash, cover.mime AS cover_mime
       FROM album a
       LEFT JOIN LATERAL (
         SELECT x.id, x.deriv_key, x.w, x.h, x.taken_at, x.camera, x.thumbhash, x.mime
         FROM asset x
         WHERE x.deleted_at IS NULL
           AND x.folder_id IN (SELECT s.folder_id FROM scope s WHERE s.album_id = a.id)
         ORDER BY x.taken_at DESC NULLS LAST, x.id DESC
         LIMIT 1
       ) cover ON true
       WHERE a.client_id = $1
       ORDER BY a.created_at DESC, a.id DESC`,
      [client.id],
    );

    const albums: AlbumCard[] = rows.map((row) => {
      const card: AlbumCard = {
        id: row.id,
        clientId: row.client_id,
        title: row.title,
        slug: row.slug,
        allowDownload: row.allow_download,
        count: row.count,
        cover:
          row.cover_id && row.cover_deriv_key
            ? toAssetItem(
                {
                  id: row.cover_id,
                  deriv_key: row.cover_deriv_key,
                  w: row.cover_w,
                  h: row.cover_h,
                  taken_at: row.cover_taken_at,
                  camera: row.cover_camera,
                  thumbhash: row.cover_thumbhash,
                  mime: row.cover_mime ?? 'application/octet-stream',
                },
                deps.thumbBase,
                row.slug,
              )
            : null,
      };
      return card;
    });

    const body: ClientResponse = {
      client: { id: client.id, name: client.name, slug: client.slug },
      albums,
    };
    return reply.header('Cache-Control', 'no-store').send(body);
  });

  app.get('/s/api/album/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const album = await findAlbumBySlug(deps.pool, slug);
    if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);

    const cam = queryText(request.query, 'cam');
    const camera = cam && cam.toLowerCase() !== 'all' ? cam : null;
    const folderIds = await albumFolderIds(deps.pool, album.id);
    const buckets = await albumBuckets(deps.pool, folderIds, camera, deps.timezone);
    const admin = await optionalAdmin(request, deps.auth);
    const cameras = await albumCameras(deps.pool, folderIds);

    const body: AlbumResponse = {
      album: {
        id: album.id,
        clientId: album.clientId,
        title: album.title,
        slug: album.slug,
        allowDownload: album.allowDownload,
      },
      client: { id: album.clientId, name: album.clientName, slug: album.clientSlug },
      cameras,
      buckets,
      total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      thumbBase: deps.thumbBase,
      viewerIsAdmin: Boolean(admin),
    };
    return reply.header('Cache-Control', 'no-store').send(body);
  });

  app.get('/s/api/album/:slug/folders', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const album = await findAlbumBySlug(deps.pool, slug);
    if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    const raw = queryText(request.query, 'folder');
    const folderId = raw ? parseBigIntId(raw) : null;
    if (raw && !folderId) return sendError(reply, 400, 'bad_id', 'ID folder tidak sah.');
    const view = await albumFolderView({
      pool: deps.pool,
      albumId: album.id,
      albumSlug: album.slug,
      thumbBase: deps.thumbBase,
      folderId,
    });
    if (view === 'not_found') return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    return reply.header('Cache-Control', 'no-store').send(view);
  });

  // Viewer deep links (`/s/<album>?p=<assetId>`) resolve one asset. Scope rules
  // are the same as `GET /s/api/o/:assetId`: an admin session, or the album that
  // owns the asset's folder. A public caller must name that album.
  app.get('/s/api/asset/:id', async (request, reply) => {
    const assetId = parseBigIntId((request.params as { id: string }).id);
    if (!assetId) return sendError(reply, 400, 'bad_id', 'ID fail tidak sah.');

    const asset = await findAssetFile(deps.pool, assetId);
    if (!asset) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);

    const admin = await optionalAdmin(request, deps.auth);
    const albumSlug = queryText(request.query, 'album');
    let album: AlbumRecord | null = null;
    if (albumSlug) {
      album = await findAlbumBySlug(deps.pool, albumSlug);
      if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    }
    if (!admin) {
      if (!album) return sendError(reply, 401, 'unauthorized', 'Sesi tidak sah atau telah tamat.');
      const folderIds = await albumFolderIds(deps.pool, album.id);
      if (!folderIds.includes(asset.folder_id)) {
        return sendError(reply, 403, 'forbidden', 'Fail ini tidak dibenarkan untuk pautan ini.');
      }
    }

    const body: AssetLookupResponse = {
      asset: toAssetItem(asset, deps.thumbBase, album?.slug),
      albumSlug: album?.slug ?? null,
    };
    return reply.header('Cache-Control', 'no-store').send(body);
  });

  app.get('/s/api/bucket/:key', async (request, reply) => {
    const key = (request.params as { key: string }).key;
    const albumSlug = queryText(request.query, 'album');
    const cam = queryText(request.query, 'cam');
    const camera = cam && cam.toLowerCase() !== 'all' ? cam : null;
    const admin = await optionalAdmin(request, deps.auth);

    const folderKey = /^f:(\d{1,19})$/.test(key);
    // Folder buckets are public only inside an album (the album scope still
    // applies, so a folder outside it returns nothing).
    if (folderKey && !admin && !albumSlug) {
      return sendError(reply, 401, 'unauthorized', 'Sesi tidak sah atau telah tamat.');
    }
    if (!MONTH_KEY.test(key) && !folderKey) {
      return sendError(reply, 400, 'bad_key', 'Kunci bucket tidak sah.');
    }

    let album: AlbumRecord | null = null;
    if (albumSlug) {
      album = await findAlbumBySlug(deps.pool, albumSlug);
      if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    } else if (!admin) {
      return sendError(reply, 401, 'unauthorized', 'Sesi tidak sah atau telah tamat.');
    }

    const cursorRaw = queryText(request.query, 'cursor');
    const cursor = cursorRaw ? decodeAssetCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) return sendError(reply, 400, 'bad_cursor', 'Kursor tidak sah.');

    const page = await fetchAssetPage({
      pool: deps.pool,
      folderIds: album ? await albumFolderIds(deps.pool, album.id) : null,
      camera,
      key,
      timezone: deps.timezone,
      cursor,
      limit: parseLimit(recordValue(request.query, 'limit'), 100, 500),
      thumbBase: deps.thumbBase,
      ...(album ? { albumSlug: album.slug } : {}),
    });

    const body: BucketResponse = { assets: page.assets, nextCursor: page.nextCursor };
    return reply.header('Cache-Control', 'no-store').send(body);
  });
}

function recordValue(query: unknown, key: string): unknown {
  const record = bodyRecord(query);
  return record?.[key];
}

interface AlbumCardRow {
  id: string;
  client_id: string;
  title: string;
  slug: string;
  allow_download: boolean;
  count: number;
  cover_id: string | null;
  cover_deriv_key: string | null;
  cover_w: number | null;
  cover_h: number | null;
  cover_taken_at: Date | null;
  cover_camera: string | null;
  cover_thumbhash: string | null;
  cover_mime: string | null;
}

export async function albumBuckets(
  pool: Pool,
  folderIds: string[],
  camera: string | null,
  timezone: string,
): Promise<BucketSummary[]> {
  if (folderIds.length === 0) return [];
  const { rows } = await pool.query<{ key: string; count: number }>(
    `SELECT to_char(taken_at AT TIME ZONE $3, 'YYYY-MM') AS key, count(*)::int AS count
     FROM asset
     WHERE deleted_at IS NULL AND taken_at IS NOT NULL
       AND folder_id = ANY($1::bigint[])
       AND ($2::text IS NULL OR camera = $2)
     GROUP BY 1 ORDER BY 1 DESC`,
    [folderIds, camera, timezone],
  );
  return rows.map((row) => ({ key: row.key, count: row.count }));
}

export async function albumCameras(pool: Pool, folderIds: string[]): Promise<string[]> {
  if (folderIds.length === 0) return [];
  const { rows } = await pool.query<{ camera: string }>(
    `SELECT DISTINCT camera FROM asset
     WHERE deleted_at IS NULL AND folder_id = ANY($1::bigint[]) AND camera IS NOT NULL
     ORDER BY camera`,
    [folderIds],
  );
  return rows.map((row) => row.camera);
}

export { MONTH_KEY };
