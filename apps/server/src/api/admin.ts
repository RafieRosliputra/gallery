import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { SLUG_REGEX, slugify, type AdminFolderNode, type AdminFolderTreeResponse, type AdminStatusResponse } from '@gallery/shared';
import { requireAdmin, type AuthDeps } from '../auth/routes.js';
import { bodyRecord, NOT_FOUND_MESSAGE, parseBigIntId, sendError } from './http.js';
import { albumFolderIds, findAlbumById, findAlbumBySlug, findClientById } from './repository.js';
import { toAssetItem } from './rows.js';

export interface AdminApiDeps {
  pool: Pool;
  auth: AuthDeps;
  timezone: string;
  thumbBase: string;
  r2Enabled: boolean;
  /** Lower-case directory names hidden from the folder tree (SCAN_EXCLUDE). */
  excludeDirectories?: string[];
  triggerScan?: () => Promise<boolean>;
  enqueueUrgentThumbs?: (assetIds: string[]) => Promise<number>;
}

const SLUG_MESSAGE = 'Link must be 3–60 characters: lower-case a-z, digits 0-9 and dashes.';
const SLUG_CONFLICT = 'That link is already used by another client or album.';
const NAME_MESSAGE = 'Name must be 1–120 characters.';

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 120;
}

const DESCRIPTION_MESSAGE = 'Description must be at most 1000 characters.';

function validDescription(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length <= 1000;
}

function validSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_REGEX.test(value);
}

function conflict(reply: FastifyReply): FastifyReply {
  return sendError(reply, 409, 'slug_conflict', SLUG_CONFLICT);
}

function albumJson(row: AlbumAdminRow, thumbBase: string): Record<string, unknown> {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    slug: row.slug,
    allowDownload: row.allow_download,
    description: row.description,
    sort: row.sort,
    clientSlug: row.client_slug,
    clientName: row.client_name,
    folderCount: row.folder_count,
    count: row.asset_count,
    cameras: row.cameras,
    covers: row.covers.map((cover) => toAssetItem(cover, thumbBase, row.slug)),
  };
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminApiDeps): void {
  const guard = (request: Parameters<typeof requireAdmin>[0], reply: FastifyReply) =>
    requireAdmin(request, reply, deps.auth);

  app.get('/s/api/admin/status', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    try {
      const { rows } = await deps.pool.query<{
        assets: number;
        pending_thumbs: number;
        pending_r2: number;
        last_scan_at: Date | null;
        errors24h: number;
      }>(
        `SELECT
           (SELECT count(*) FROM asset WHERE deleted_at IS NULL)::int AS assets,
           (SELECT count(*) FROM asset WHERE deleted_at IS NULL AND thumb_ok = false)::int AS pending_thumbs,
           (SELECT count(*) FROM asset WHERE deleted_at IS NULL AND thumb_ok = true AND r2_ok = false)::int AS pending_r2,
           (SELECT max(finished_at) FROM scan_run) AS last_scan_at,
           (SELECT count(*) FROM job_error WHERE created_at > now() - interval '24 hours')::int AS errors24h`,
      );
      const row = rows[0];
      if (!row) throw new Error('status query returned no rows');
      const body: AdminStatusResponse = {
        assets: row.assets,
        pendingThumbs: row.pending_thumbs,
        pendingR2: deps.r2Enabled ? row.pending_r2 : 0,
        r2Enabled: deps.r2Enabled,
        lastScanAt: row.last_scan_at ? row.last_scan_at.toISOString() : null,
        errors24h: row.errors24h,
      };
      return reply.send(body);
    } catch (error) {
      request.log.error({ err: error }, 'status query failed');
      return reply.code(503).send({ error: 'status_unavailable', message: 'Status is not available.' });
    }
  });

  app.get('/s/api/admin/clients', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const { rows } = await deps.pool.query<{ id: string; name: string; slug: string; description: string; album_count: number }>(
      `SELECT c.id, c.name, c.slug, c.description,
              (SELECT count(*) FROM album a WHERE a.client_id = c.id)::int AS album_count
       FROM client c ORDER BY c.created_at DESC, c.id DESC`,
    );
    return reply.send({ clients: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        albumCount: row.album_count,
      })) });
  });

  app.post('/s/api/admin/clients', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const body = bodyRecord(request.body);
    if (!body) return sendError(reply, 400, 'bad_request', 'Invalid request.');
    const { name, slug } = body;
    if (!validName(name)) return sendError(reply, 400, 'bad_name', NAME_MESSAGE);
    if (!validSlug(slug)) return sendError(reply, 400, 'bad_slug', SLUG_MESSAGE);

    try {
      const { rows } = await deps.pool.query<{ id: string; name: string; slug: string }>(
        'INSERT INTO client (name, slug) VALUES ($1, $2) RETURNING id, name, slug, description',
        [name.trim(), slug],
      );
      const row = rows[0];
      if (!row) throw new Error('client insert returned no row');
      return reply.code(201).send({ client: row });
    } catch (error) {
      if (pgCode(error) === '23505') return conflict(reply);
      throw error;
    }
  });

  app.patch('/s/api/admin/clients/:id', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const body = bodyRecord(request.body);
    if (!body) return sendError(reply, 400, 'bad_request', 'Invalid request.');

    const name = body['name'];
    const slug = body['slug'];
    const description = body['description'];
    if (name === undefined && slug === undefined && description === undefined) {
      return sendError(reply, 400, 'bad_request', 'Nothing to change.');
    }
    if (name !== undefined && !validName(name)) return sendError(reply, 400, 'bad_name', NAME_MESSAGE);
    if (slug !== undefined && !validSlug(slug)) return sendError(reply, 400, 'bad_slug', SLUG_MESSAGE);
    if (description !== undefined && !validDescription(description)) {
      return sendError(reply, 400, 'bad_description', DESCRIPTION_MESSAGE);
    }

    try {
      const { rows } = await deps.pool.query<{ id: string; name: string; slug: string; description: string }>(
        `UPDATE client SET name = COALESCE($2, name), slug = COALESCE($3, slug), description = COALESCE($4, description)
         WHERE id = $1 RETURNING id, name, slug, description`,
        [
          id,
          name === undefined ? null : (name as string).trim(),
          slug === undefined ? null : slug,
          description === undefined ? null : (description as string).trim(),
        ],
      );
      const row = rows[0];
      if (!row) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      return reply.send({ client: row });
    } catch (error) {
      if (pgCode(error) === '23505') return conflict(reply);
      throw error;
    }
  });

  app.delete('/s/api/admin/clients/:id', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const result = await deps.pool.query('DELETE FROM client WHERE id = $1', [id]);
    if (result.rowCount === 0) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    return reply.code(204).send();
  });

  // One client's albums with their folder rules (each album = one ticked folder).
  app.get('/s/api/admin/clients/:id/albums', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const client = await findClientById(deps.pool, id);
    if (!client) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    const { rows } = await deps.pool.query<{
      id: string;
      title: string;
      slug: string;
      allow_download: boolean;
      description: string;
      count: number;
      rules: { folderId: string; path: string; included: boolean }[];
    }>(
      `SELECT a.id::text AS id, a.title, a.slug, a.allow_download, a.description,
              (SELECT count(*) FROM asset x
               WHERE x.deleted_at IS NULL AND x.folder_id IN (SELECT fid FROM album_scope(a.id)))::int AS count,
              COALESCE((SELECT json_agg(json_build_object('folderId', af.folder_id::text, 'path', f.path, 'included', af.included)
                                  ORDER BY f.path)
                        FROM album_folder af JOIN folder f ON f.id = af.folder_id
                        WHERE af.album_id = a.id), '[]'::json) AS rules
       FROM album a WHERE a.client_id = $1
       ORDER BY a.created_at DESC, a.id DESC`,
      [id],
    );
    return reply.send({
      client,
      albums: rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        allowDownload: row.allow_download,
        description: row.description,
        count: row.count,
        rules: row.rules,
      })),
    });
  });

  // Tick a folder on the client page: it becomes an album named after the folder,
  // with a link slug derived from that name (made unique with -2, -3 …).
  app.post('/s/api/admin/clients/:id/albums', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const raw = bodyRecord(request.body)?.['folderId'];
    const folderId = typeof raw === 'string' ? parseBigIntId(raw) : null;
    if (!folderId) return sendError(reply, 400, 'bad_id', 'Invalid folder id.');
    if (!(await findClientById(deps.pool, id))) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    const folder = (await deps.pool.query<{ path: string }>('SELECT path FROM folder WHERE id = $1', [folderId])).rows[0];
    if (!folder) return sendError(reply, 400, 'bad_folder', 'Folder not found.');

    const title = (folder.path === '.' ? 'All photos' : path.posix.basename(folder.path)).slice(0, 120);
    const base = slugify(title);
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const suffix = attempt === 1 ? '' : `-${attempt}`;
      const slug = `${base.slice(0, 60 - suffix.length).replace(/-+$/g, '')}${suffix}`;
      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO album (client_id, title, slug, allow_download) VALUES ($1, $2, $3, true) RETURNING id::text AS id',
          [id, title, slug],
        );
        const albumId = inserted.rows[0]?.id;
        await client.query(
          'INSERT INTO album_folder (album_id, folder_id, recursive, included) VALUES ($1, $2, true, true)',
          [albumId, folderId],
        );
        await client.query('COMMIT');
        return reply.code(201).send({
          album: {
            id: albumId,
            title,
            slug,
            allowDownload: true,
            description: '',
            count: 0,
            rules: [{ folderId, path: folder.path, included: true }],
          },
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (pgCode(error) !== '23505') throw error;
      } finally {
        client.release();
      }
    }
    return conflict(reply);
  });

  app.get('/s/api/admin/albums', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const clientIdRaw = (request.query as Record<string, unknown> | undefined)?.['client_id'];
    let clientId: string | null = null;
    if (typeof clientIdRaw === 'string' && clientIdRaw !== '') {
      clientId = parseBigIntId(clientIdRaw);
      if (!clientId) return sendError(reply, 400, 'bad_id', 'Invalid client id.');
    }
    // One statement for the whole list: scope, count, distinct cameras and up
    // to three covers per album. The admin UI must not fan out per album.
    const { rows } = await deps.pool.query<AlbumAdminRow>(
      `WITH scope AS (
         SELECT al.id AS album_id, s.fid AS folder_id
         FROM album al CROSS JOIN LATERAL album_scope(al.id) s
         WHERE ($1::bigint IS NULL OR al.client_id = $1)
       ),
       stats AS (
         SELECT s.album_id,
                count(x.id)::int AS asset_count,
                array_agg(DISTINCT x.camera ORDER BY x.camera)
                  FILTER (WHERE x.camera IS NOT NULL) AS cameras
         FROM scope s
         LEFT JOIN asset x ON x.folder_id = s.folder_id AND x.deleted_at IS NULL
         GROUP BY s.album_id
       ),
       covers AS (
         SELECT album_id,
                json_agg(json_build_object(
                  'id', id::text, 'deriv_key', deriv_key, 'w', w, 'h', h,
                  'taken_at', taken_at, 'camera', camera, 'thumbhash', thumbhash, 'mime', mime
                ) ORDER BY rn) AS covers
         FROM (
           SELECT s.album_id, x.id, x.deriv_key, x.w, x.h, x.taken_at, x.camera, x.thumbhash, x.mime,
                  row_number() OVER (
                    PARTITION BY s.album_id
                    ORDER BY x.taken_at DESC NULLS LAST, x.id DESC
                  ) AS rn
           FROM scope s
           JOIN asset x ON x.folder_id = s.folder_id AND x.deleted_at IS NULL
         ) ranked
         WHERE rn <= 3
         GROUP BY album_id
       )
       SELECT a.id, a.client_id, a.title, a.slug, a.allow_download, a.description, a.sort,
              c.slug AS client_slug, c.name AS client_name,
              (SELECT count(*) FROM album_folder af WHERE af.album_id = a.id AND af.included)::int AS folder_count,
              COALESCE(st.asset_count, 0) AS asset_count,
              COALESCE(st.cameras, ARRAY[]::text[]) AS cameras,
              COALESCE(cv.covers, '[]'::json) AS covers
       FROM album a
       JOIN client c ON c.id = a.client_id
       LEFT JOIN stats st ON st.album_id = a.id
       LEFT JOIN covers cv ON cv.album_id = a.id
       WHERE ($1::bigint IS NULL OR a.client_id = $1)
       ORDER BY a.created_at DESC, a.id DESC`,
      [clientId],
    );
    return reply.send({ albums: rows.map((row) => albumJson(row, deps.thumbBase)) });
  });

  app.post('/s/api/admin/albums', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const body = bodyRecord(request.body);
    if (!body) return sendError(reply, 400, 'bad_request', 'Invalid request.');
    const clientIdRaw = body['client_id'] ?? body['clientId'];
    const title = body['title'];
    const slug = body['slug'];
    const allowDownload = body['allow_download'] ?? body['allowDownload'];
    const clientId = typeof clientIdRaw === 'string' ? parseBigIntId(clientIdRaw) : null;
    if (!clientId) return sendError(reply, 400, 'bad_id', 'Invalid client id.');
    if (!validName(title)) return sendError(reply, 400, 'bad_title', 'Title must be 1–120 characters.');
    if (!validSlug(slug)) return sendError(reply, 400, 'bad_slug', SLUG_MESSAGE);
    if (allowDownload !== undefined && typeof allowDownload !== 'boolean') {
      return sendError(reply, 400, 'bad_request', 'allow_download must be a boolean.');
    }
    if (!(await findClientById(deps.pool, clientId))) {
      return sendError(reply, 400, 'bad_client', 'Client not found.');
    }

    try {
      const { rows } = await deps.pool.query<AlbumAdminRow>(
        `INSERT INTO album (client_id, title, slug, allow_download)
         VALUES ($1, $2, $3, COALESCE($4, true))
         RETURNING id, client_id, title, slug, allow_download, description, sort,
                   (SELECT slug FROM client WHERE id = $1) AS client_slug,
                   (SELECT name FROM client WHERE id = $1) AS client_name,
                   0::int AS folder_count,
                   0::int AS asset_count,
                   ARRAY[]::text[] AS cameras,
                   '[]'::json AS covers`,
        [clientId, title.trim(), slug, allowDownload ?? null],
      );
      const row = rows[0];
      if (!row) throw new Error('album insert returned no row');
      return reply.code(201).send({ album: albumJson(row, deps.thumbBase) });
    } catch (error) {
      if (pgCode(error) === '23505') return conflict(reply);
      throw error;
    }
  });

  app.patch('/s/api/admin/albums/:id', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const body = bodyRecord(request.body);
    if (!body) return sendError(reply, 400, 'bad_request', 'Invalid request.');

    const clientIdRaw = body['client_id'] ?? body['clientId'];
    const title = body['title'];
    const slug = body['slug'];
    const allowDownload = body['allow_download'] ?? body['allowDownload'];
    const description = body['description'];
    if (description !== undefined && !validDescription(description)) {
      return sendError(reply, 400, 'bad_description', DESCRIPTION_MESSAGE);
    }
    const sort = body['sort'];
    if (sort !== undefined && sort !== 'name' && sort !== 'taken' && sort !== 'taken_desc') {
      return sendError(reply, 400, 'bad_sort', 'sort must be name, taken or taken_desc.');
    }
    if (
      sort === undefined &&
      clientIdRaw === undefined &&
      title === undefined &&
      slug === undefined &&
      allowDownload === undefined &&
      description === undefined
    ) {
      return sendError(reply, 400, 'bad_request', 'Nothing to change.');
    }
    let clientId: string | null = null;
    if (clientIdRaw !== undefined) {
      if (typeof clientIdRaw !== 'string' || !(clientId = parseBigIntId(clientIdRaw))) {
        return sendError(reply, 400, 'bad_id', 'Invalid client id.');
      }
      if (!(await findClientById(deps.pool, clientId))) {
        return sendError(reply, 400, 'bad_client', 'Client not found.');
      }
    }
    if (title !== undefined && !validName(title)) {
      return sendError(reply, 400, 'bad_title', 'Title must be 1–120 characters.');
    }
    if (slug !== undefined && !validSlug(slug)) return sendError(reply, 400, 'bad_slug', SLUG_MESSAGE);
    if (allowDownload !== undefined && typeof allowDownload !== 'boolean') {
      return sendError(reply, 400, 'bad_request', 'allow_download must be a boolean.');
    }

    try {
      const { rows } = await deps.pool.query<AlbumAdminRow>(
        `UPDATE album SET client_id = COALESCE($2, client_id),
                          title = COALESCE($3, title),
                          slug = COALESCE($4, slug),
                          allow_download = COALESCE($5, allow_download),
                          description = COALESCE($6, description),
                          sort = COALESCE($7, sort)
         WHERE id = $1
         RETURNING id, client_id, title, slug, allow_download, description, sort,
                   (SELECT slug FROM client WHERE id = album.client_id) AS client_slug,
                   (SELECT name FROM client WHERE id = album.client_id) AS client_name,
                   (SELECT count(*) FROM album_folder af WHERE af.album_id = album.id AND af.included)::int AS folder_count,
                   0::int AS asset_count,
                   ARRAY[]::text[] AS cameras,
                   '[]'::json AS covers`,
        [
          id,
          clientId,
          title === undefined ? null : (title as string).trim(),
          slug === undefined ? null : slug,
          allowDownload === undefined ? null : allowDownload,
          description === undefined ? null : (description as string).trim(),
          sort ?? null,
        ],
      );
      const row = rows[0];
      if (!row) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      return reply.send({ album: albumJson(row, deps.thumbBase) });
    } catch (error) {
      if (pgCode(error) === '23505') return conflict(reply);
      throw error;
    }
  });

  app.delete('/s/api/admin/albums/:id', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const result = await deps.pool.query('DELETE FROM album WHERE id = $1', [id]);
    if (result.rowCount === 0) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    return reply.code(204).send();
  });

  app.get('/s/api/admin/albums/:id/folders', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    if (!(await findAlbumById(deps.pool, id))) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    const { rows } = await deps.pool.query<{ folder_id: string; path: string; recursive: boolean; included: boolean }>(
      `SELECT af.folder_id, f.path, af.recursive, af.included
       FROM album_folder af JOIN folder f ON f.id = af.folder_id
       WHERE af.album_id = $1 ORDER BY f.path`,
      [id],
    );
    return reply.send({
      folders: rows.map((row) => ({
        folderId: row.folder_id,
        path: row.path,
        recursive: row.recursive,
        included: row.included,
      })),
    });
  });

  // Replace the album's rule set in one transaction. Each rule is recursive:
  // included = true adds the folder subtree, false carves it back out.
  app.put('/s/api/admin/albums/:id/folders', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const rules = parseRules(bodyRecord(request.body)?.['rules']);
    if (!rules) return sendError(reply, 400, 'bad_rules', 'Invalid folder list.');
    if (!(await findAlbumById(deps.pool, id))) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);

    const client = await deps.pool.connect();
    try {
      await client.query('BEGIN');
      const known = await client.query<{ id: string }>('SELECT id FROM folder WHERE id = ANY($1::bigint[])', [
        rules.map((rule) => rule.folderId),
      ]);
      if (known.rows.length !== rules.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'bad_folder', 'Folder not found.');
      }
      await client.query('DELETE FROM album_folder WHERE album_id = $1', [id]);
      if (rules.length > 0) {
        await client.query(
          `INSERT INTO album_folder (album_id, folder_id, recursive, included)
           SELECT $1, u.fid, true, u.inc FROM unnest($2::bigint[], $3::boolean[]) AS u(fid, inc)`,
          [id, rules.map((rule) => rule.folderId), rules.map((rule) => rule.included)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const stats = await scopeStats(deps.pool, 'SELECT fid FROM album_scope($1)', [id]);
    return reply.send({ rules: rules.length, ...stats });
  });

  // Thumbnail progress for one album.
  app.get('/s/api/admin/albums/:id/thumbs', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    if (!(await findAlbumById(deps.pool, id))) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    const { rows } = await deps.pool.query<{ total: number; ready: number; failed: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE a.thumb_ok)::int AS ready,
              count(*) FILTER (WHERE NOT a.thumb_ok AND a.thumb_attempts >= 5)::int AS failed
       FROM asset a
       WHERE a.deleted_at IS NULL AND a.folder_id IN (SELECT fid FROM album_scope($1))`,
      [id],
    );
    const row = rows[0] ?? { total: 0, ready: 0, failed: 0 };
    return reply.send({ total: row.total, ready: row.ready, pending: row.total - row.ready, failed: row.failed });
  });

  // "Generate now": retry failed thumbnails and queue every missing one ahead of the backlog.
  app.post('/s/api/admin/albums/:id/thumbs', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    if (!(await findAlbumById(deps.pool, id))) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    if (!deps.enqueueUrgentThumbs) {
      return sendError(reply, 503, 'queue_unavailable', 'The job queue is not available in this process.');
    }
    const { rows } = await deps.pool.query<{ id: string }>(
      `UPDATE asset SET thumb_attempts = 0, thumb_queued_at = now()
       WHERE deleted_at IS NULL AND thumb_ok = false AND folder_id IN (SELECT fid FROM album_scope($1))
       RETURNING id::text AS id`,
      [id],
    );
    const queued = rows.length > 0 ? await deps.enqueueUrgentThumbs(rows.map((row) => row.id)) : 0;
    return reply.send({ queued });
  });

  // Folders the scanner saw move (newest first).
  app.get('/s/api/admin/moves', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const { rows } = await deps.pool.query<{ from_path: string; to_path: string; assets: number; albums: number; moved_at: Date }>(
      'SELECT from_path, to_path, assets, albums, moved_at FROM folder_move ORDER BY moved_at DESC, id DESC LIMIT 50',
    );
    return reply.send({
      moves: rows.map((row) => ({
        from: row.from_path,
        to: row.to_path,
        assets: row.assets,
        albums: row.albums,
        movedAt: row.moved_at.toISOString(),
      })),
    });
  });

  // Live total for unsaved rules in the album editor.
  app.post('/s/api/admin/scope-preview', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const rules = parseRules(bodyRecord(request.body)?.['rules']);
    if (!rules) return sendError(reply, 400, 'bad_rules', 'Invalid folder list.');
    const stats = await scopeStats(deps.pool, 'SELECT fid FROM folder_scope($1::bigint[], $2::boolean[], $3::boolean[])', [
      rules.map((rule) => rule.folderId),
      rules.map((rule) => rule.included),
      rules.map(() => true),
    ]);
    return reply.send(stats);
  });

  app.post('/s/api/admin/albums/:id/folders', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    if (!id) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const body = bodyRecord(request.body);
    if (!body) return sendError(reply, 400, 'bad_request', 'Invalid request.');
    const folderIdRaw = body['folderId'] ?? body['folder_id'];
    const folderId = typeof folderIdRaw === 'string' ? parseBigIntId(folderIdRaw) : null;
    if (!folderId) return sendError(reply, 400, 'bad_id', 'Invalid folder id.');
    const recursive = body['recursive'];
    if (recursive !== undefined && typeof recursive !== 'boolean') {
      return sendError(reply, 400, 'bad_request', 'recursive must be a boolean.');
    }
    const included = body['included'];
    if (included !== undefined && typeof included !== 'boolean') {
      return sendError(reply, 400, 'bad_request', 'included must be a boolean.');
    }
    if (!(await findAlbumById(deps.pool, id))) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    const folder = await deps.pool.query<{ id: string; path: string }>('SELECT id, path FROM folder WHERE id = $1', [
      folderId,
    ]);
    if (!folder.rows[0]) return sendError(reply, 400, 'bad_folder', 'Folder not found.');

    const { rows } = await deps.pool.query<{ folder_id: string; path: string; recursive: boolean; included: boolean }>(
      `INSERT INTO album_folder (album_id, folder_id, recursive, included) VALUES ($1, $2, $3, $4)
       ON CONFLICT (album_id, folder_id) DO UPDATE SET recursive = EXCLUDED.recursive, included = EXCLUDED.included
       RETURNING folder_id, recursive, included,
                 (SELECT path FROM folder WHERE id = $2) AS path`,
      [id, folderId, recursive ?? true, included ?? true],
    );
    return reply.send({ folder: rows[0] });
  });

  app.delete('/s/api/admin/albums/:id/folders/:folderId', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const id = parseBigIntId((request.params as { id: string }).id);
    const folderId = parseBigIntId((request.params as { folderId: string }).folderId);
    if (!id || !folderId) return sendError(reply, 400, 'bad_id', 'Invalid id.');
    const result = await deps.pool.query('DELETE FROM album_folder WHERE album_id = $1 AND folder_id = $2', [id, folderId]);
    if (result.rowCount === 0) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    return reply.code(204).send();
  });

  app.get('/s/api/admin/folders', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const parentRaw = (request.query as Record<string, unknown> | undefined)?.['parent'];
    let parent: FolderNodeRow | null = null;

    if (parentRaw === undefined || parentRaw === '' || parentRaw === 'root') {
      const root = await deps.pool.query<FolderNodeRow>(folderNodeSql('f.path = $1'), ['.']);
      parent = root.rows[0] ?? null;
      if (!parent) {
        const body: AdminFolderTreeResponse = { parent: null, folders: [] };
        return reply.send(body);
      }
    } else {
      const parentId = typeof parentRaw === 'string' ? parseBigIntId(parentRaw) : null;
      if (!parentId) return sendError(reply, 400, 'bad_id', 'Invalid folder id.');
      const found = await deps.pool.query<FolderNodeRow>(folderNodeSql('f.id = $1'), [parentId]);
      parent = found.rows[0] ?? null;
      if (!parent) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
    }

    const children = await deps.pool.query<FolderNodeRow>(
      folderNodeSql(
        `f.parent_id = $1 AND lower(regexp_replace(f.path, '^.*/', '')) <> ALL($2::text[])`,
      ) + ' ORDER BY f.path LIMIT 500',
      [parent.id, deps.excludeDirectories ?? []],
    );
    const body: AdminFolderTreeResponse = {
      parent: toFolderNode(parent),
      folders: children.rows.map(toFolderNode),
    };
    return reply.send(body);
  });

  const bucketsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const mode = typeof query['mode'] === 'string' ? query['mode'] : 'date';
    if (mode !== 'date' && mode !== 'folder') {
      return sendError(reply, 400, 'bad_mode', 'mode must be date or folder.');
    }
    const albumSlug = typeof query['album'] === 'string' && query['album'] !== '' ? query['album'] : null;
    let folderIds: string[] | null = null;
    if (albumSlug) {
      const album = await findAlbumByIdOrSlug(deps.pool, albumSlug);
      if (!album) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);
      folderIds = album;
    }

    if (mode === 'date') {
      const values: unknown[] = [deps.timezone];
      const where = ['deleted_at IS NULL', 'taken_at IS NOT NULL'];
      if (folderIds) {
        values.push(folderIds);
        where.push(`folder_id = ANY($${values.length}::bigint[])`);
      }
      const { rows } = await deps.pool.query<{ key: string; count: number }>(
        `SELECT to_char(taken_at AT TIME ZONE $1, 'YYYY-MM') AS key, count(*)::int AS count
         FROM asset WHERE ${where.join(' AND ')}
         GROUP BY 1 ORDER BY 1 DESC`,
        values,
      );
      return reply.send({ buckets: rows });
    }

    const values: unknown[] = [];
    const where = ['a.deleted_at IS NULL', 'a.taken_at IS NOT NULL'];
    if (folderIds) {
      values.push(folderIds);
      where.push(`a.folder_id = ANY($${values.length}::bigint[])`);
    }
    const { rows } = await deps.pool.query<{ key: string; label: string; count: number }>(
      `SELECT 'f:' || a.folder_id AS key, f.path AS label, count(*)::int AS count
       FROM asset a JOIN folder f ON f.id = a.folder_id
       WHERE ${where.join(' AND ')}
       GROUP BY a.folder_id, f.path ORDER BY f.path`,
      values,
    );
    return reply.send({ buckets: rows });
  };

  // SPEC § API calls this route without the /admin prefix; keep both.
  app.get('/s/api/admin/buckets', bucketsHandler);
  app.get('/s/api/buckets', bucketsHandler);

  app.post('/s/api/admin/rescan', async (request, reply) => {
    const session = await guard(request, reply);
    if (!session) return reply;
    if (!deps.triggerScan) {
      return sendError(reply, 503, 'scan_unavailable', 'The scanner is not available in this process.');
    }
    const started = await deps.triggerScan();
    if (!started) return sendError(reply, 409, 'scan_running', 'A scan is already running.');
    return reply.code(202).send({ started: true });
  });
}

interface AlbumAdminRow {
  id: string;
  client_id: string;
  title: string;
  slug: string;
  allow_download: boolean;
  description: string;
  sort: string;
  client_slug: string;
  client_name: string;
  folder_count: number;
  asset_count: number;
  cameras: string[];
  covers: AlbumCoverRow[];
}

interface AlbumCoverRow {
  id: string;
  deriv_key: string;
  w: number | null;
  h: number | null;
  taken_at: string | null;
  camera: string | null;
  thumbhash: string | null;
  mime: string;
}

interface FolderNodeRow {
  id: string;
  path: string;
  parent_id: string | null;
  asset_count: number;
  total_count: number;
  has_children: boolean;
}

function folderNodeSql(condition: string): string {
  return `SELECT f.id, f.path, f.parent_id,
                 (SELECT count(*) FROM asset a WHERE a.folder_id = f.id AND a.deleted_at IS NULL)::int AS asset_count,
                 (SELECT count(*) FROM asset a JOIN folder d ON d.id = a.folder_id
                  WHERE a.deleted_at IS NULL
                    AND (d.id = f.id OR f.path = '.' OR starts_with(d.path, f.path || '/')))::int AS total_count,
                 EXISTS(SELECT 1 FROM folder c WHERE c.parent_id = f.id) AS has_children
          FROM folder f WHERE ${condition}`;
}

function toFolderNode(row: FolderNodeRow): AdminFolderNode {
  return {
    id: row.id,
    path: row.path,
    name: row.path === '.' ? '/' : path.posix.basename(row.path),
    parentId: row.parent_id,
    assetCount: row.asset_count,
    totalCount: row.total_count,
    hasChildren: row.has_children,
  };
}

const MAX_RULES = 2000;

/** `[{ folderId, included }]`, unique folders, at most MAX_RULES. */
function parseRules(value: unknown): { folderId: string; included: boolean }[] | null {
  if (!Array.isArray(value) || value.length > MAX_RULES) return null;
  const seen = new Set<string>();
  const rules: { folderId: string; included: boolean }[] = [];
  for (const item of value) {
    const record = bodyRecord(item);
    if (!record) return null;
    const raw = record['folderId'];
    const folderId = typeof raw === 'string' ? parseBigIntId(raw) : null;
    const included = record['included'];
    if (!folderId || typeof included !== 'boolean' || seen.has(folderId)) return null;
    seen.add(folderId);
    rules.push({ folderId, included });
  }
  return rules;
}

async function scopeStats(
  pool: Pool,
  scopeSql: string,
  values: unknown[],
): Promise<{ assetCount: number; folderCount: number }> {
  const { rows } = await pool.query<{ asset_count: number; folder_count: number }>(
    `WITH scope AS (${scopeSql})
     SELECT (SELECT count(*) FROM asset a WHERE a.deleted_at IS NULL AND a.folder_id IN (SELECT fid FROM scope))::int AS asset_count,
            (SELECT count(DISTINCT a.folder_id) FROM asset a
             WHERE a.deleted_at IS NULL AND a.folder_id IN (SELECT fid FROM scope))::int AS folder_count`,
    values,
  );
  return { assetCount: rows[0]?.asset_count ?? 0, folderCount: rows[0]?.folder_count ?? 0 };
}

/** Admin bucket filter accepts either an album id or a slug. */
async function findAlbumByIdOrSlug(pool: Pool, value: string): Promise<string[] | null> {
  const byId = parseBigIntId(value);
  const album = byId ? await findAlbumById(pool, byId) : await findAlbumBySlug(pool, value);
  return album ? albumFolderIds(pool, album.id) : null;
}
