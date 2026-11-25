import type { Pool } from 'pg';
import type { AssetRow } from './rows.js';
import type { AssetOrder } from './assets-query.js';

export interface ClientRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export interface AlbumRecord {
  id: string;
  clientId: string;
  title: string;
  slug: string;
  allowDownload: boolean;
  description: string;
  /** Photo order inside folders. */
  sort: AssetOrder;
  clientSlug: string;
  clientName: string;
  clientDescription: string;
}

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  description: string;
}

interface AlbumRow {
  id: string;
  client_id: string;
  title: string;
  slug: string;
  allow_download: boolean;
  description: string;
  sort: AssetOrder;
  client_slug: string;
  client_name: string;
  client_description: string;
}

function toClient(row: ClientRow): ClientRecord {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description };
}

function toAlbum(row: AlbumRow): AlbumRecord {
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
    clientDescription: row.client_description,
  };
}

export async function findClientBySlug(pool: Pool, slug: string): Promise<ClientRecord | null> {
  const { rows } = await pool.query<ClientRow>('SELECT id, name, slug, description FROM client WHERE slug = $1', [slug]);
  const row = rows[0];
  return row ? toClient(row) : null;
}

export async function findClientById(pool: Pool, id: string): Promise<ClientRecord | null> {
  const { rows } = await pool.query<ClientRow>('SELECT id, name, slug, description FROM client WHERE id = $1', [id]);
  const row = rows[0];
  return row ? toClient(row) : null;
}

export async function findAlbumBySlug(pool: Pool, slug: string): Promise<AlbumRecord | null> {
  const { rows } = await pool.query<AlbumRow>(
    `SELECT a.id, a.client_id, a.title, a.slug, a.allow_download, a.description, a.sort,
            c.slug AS client_slug, c.name AS client_name, c.description AS client_description
     FROM album a JOIN client c ON c.id = a.client_id
     WHERE a.slug = $1`,
    [slug],
  );
  const row = rows[0];
  return row ? toAlbum(row) : null;
}

export async function findAlbumById(pool: Pool, id: string): Promise<AlbumRecord | null> {
  const { rows } = await pool.query<AlbumRow>(
    `SELECT a.id, a.client_id, a.title, a.slug, a.allow_download, a.description, a.sort,
            c.slug AS client_slug, c.name AS client_name, c.description AS client_description
     FROM album a JOIN client c ON c.id = a.client_id
     WHERE a.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toAlbum(row) : null;
}

/**
 * Folder ids covered by an album: per folder the most specific album_folder
 * rule wins (see db/migrations/006_album_rules.sql), included rules select.
 */
export async function albumFolderIds(pool: Pool, albumId: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>('SELECT fid::text AS id FROM album_scope($1)', [albumId]);
  return rows.map((row) => row.id);
}

export interface AssetFileRow extends AssetRow {
  path: string;
  hot_until: Date | null;
  folder_id: string;
}

export async function findAssetFile(pool: Pool, id: string): Promise<AssetFileRow | null> {
  const { rows } = await pool.query<AssetFileRow>(
    `SELECT id, deriv_key, w, h, taken_at, camera, thumbhash, mime, path, hot_until, folder_id
     FROM asset WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

export async function assetInAlbum(pool: Pool, assetFolderId: string, albumId: string): Promise<boolean> {
  const folderIds = await albumFolderIds(pool, albumId);
  return folderIds.includes(assetFolderId);
}
