import type { Pool } from 'pg';
import type { AssetItem } from '@gallery/shared';
import { toAssetItem, type AssetRow } from './rows.js';

/** Photo order: newest first (timeline), oldest first, or file name A→Z. */
export type AssetOrder = 'taken_desc' | 'taken' | 'name';

export interface AssetCursor {
  takenAt?: Date;
  path?: string;
  id: string;
}

export interface AssetPageOptions {
  pool: Pool;
  /** null = no album scope (admin library view). */
  folderIds: string[] | null;
  camera: string | null;
  /** `YYYY-MM`, or `f:<folderId>` for the admin folder timeline. */
  key: string;
  timezone: string;
  cursor: AssetCursor | null;
  limit: number;
  thumbBase: string;
  albumSlug?: string;
  /** Optional explicit asset ids (ZIP favourites); capped by the caller. */
  ids?: string[];
  /** Defaults to taken_desc. */
  order?: AssetOrder;
}

export interface AssetPage {
  assets: AssetItem[];
  nextCursor: string | null;
}

export function encodeAssetCursor(
  row: { taken_at: Date | string | null; id: string; path?: string },
  order: AssetOrder = 'taken_desc',
): string | null {
  const payload =
    order === 'name'
      ? row.path === undefined
        ? null
        : { p: row.path, i: row.id }
      : row.taken_at
        ? { t: new Date(row.taken_at).toISOString(), i: row.id }
        : null;
  return payload ? Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url') : null;
}

export function decodeAssetCursor(raw: string): AssetCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const i = record['i'];
    if (typeof i !== 'string' || !/^\d{1,19}$/.test(i)) return null;
    const t = record['t'];
    const p = record['p'];
    if (typeof p === 'string' && p.length > 0 && p.length < 4096) return { path: p, id: i };
    if (typeof t !== 'string') return null;
    const takenAt = new Date(t);
    if (Number.isNaN(takenAt.getTime())) return null;
    return { takenAt, id: i };
  } catch {
    return null;
  }
}

function folderKey(key: string): string | null {
  const match = /^f:(\d{1,19})$/.exec(key);
  return match?.[1] ?? null;
}

/** Keyset page in the requested order (default taken_at DESC, id DESC). Never OFFSET. */
export async function fetchAssetPage(options: AssetPageOptions): Promise<AssetPage> {
  const values: unknown[] = [];
  const where: string[] = ['deleted_at IS NULL', 'taken_at IS NOT NULL'];
  let timezoneIndex: number | null = null;

  if (options.folderIds) {
    values.push(options.folderIds);
    where.push(`folder_id = ANY($${values.length}::bigint[])`);
  }
  if (options.camera) {
    values.push(options.camera);
    where.push(`camera = $${values.length}`);
  }
  if (options.ids) {
    values.push(options.ids);
    where.push(`id = ANY($${values.length}::bigint[])`);
  }

  const directFolder = folderKey(options.key);
  if (directFolder) {
    values.push(directFolder);
    where.push(`folder_id = $${values.length}`);
  } else {
    values.push(options.timezone);
    timezoneIndex = values.length;
    values.push(options.key);
    where.push(`to_char(taken_at AT TIME ZONE $${timezoneIndex}, 'YYYY-MM') = $${values.length}`);
  }

  const order: AssetOrder = options.order ?? 'taken_desc';
  if (options.cursor) {
    if (order === 'name') {
      if (options.cursor.path === undefined) return { assets: [], nextCursor: null };
      values.push(options.cursor.path);
      const pathIndex = values.length;
      values.push(options.cursor.id);
      where.push(`(path > $${pathIndex} OR (path = $${pathIndex} AND id > $${values.length}::bigint))`);
    } else {
      if (!options.cursor.takenAt) return { assets: [], nextCursor: null };
      values.push(options.cursor.takenAt);
      const takenIndex = values.length;
      values.push(options.cursor.id);
      const idIndex = values.length;
      const op = order === 'taken' ? '>' : '<';
      where.push(`(taken_at ${op} $${takenIndex} OR (taken_at = $${takenIndex} AND id ${op} $${idIndex}::bigint))`);
    }
  }

  values.push(options.limit + 1);
  const limitIndex = values.length;
  const orderBy =
    order === 'name' ? 'path ASC, id ASC' : order === 'taken' ? 'taken_at ASC, id ASC' : 'taken_at DESC, id DESC';

  const { rows } = await options.pool.query<AssetRow & { path: string }>(
    `SELECT id, deriv_key, w, h, taken_at, camera, thumbhash, mime, path
     FROM asset
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $${limitIndex}`,
    values,
  );

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    assets: pageRows.map((row) => toAssetItem(row, options.thumbBase, options.albumSlug)),
    nextCursor: hasMore && last ? encodeAssetCursor(last, order) : null,
  };
}
