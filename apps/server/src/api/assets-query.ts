import type { Pool } from 'pg';
import type { AssetItem } from '@gallery/shared';
import { toAssetItem, type AssetRow } from './rows.js';

export interface AssetCursor {
  takenAt: Date;
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
}

export interface AssetPage {
  assets: AssetItem[];
  nextCursor: string | null;
}

export function encodeAssetCursor(row: { taken_at: Date | string | null; id: string }): string | null {
  if (!row.taken_at) return null;
  return Buffer.from(
    JSON.stringify({ t: new Date(row.taken_at).toISOString(), i: row.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeAssetCursor(raw: string): AssetCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const t = record['t'];
    const i = record['i'];
    if (typeof t !== 'string' || typeof i !== 'string' || !/^\d{1,19}$/.test(i)) return null;
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

/** Keyset page ordered by taken_at DESC, id DESC. Never OFFSET. */
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

  if (options.cursor) {
    values.push(options.cursor.takenAt);
    const takenIndex = values.length;
    values.push(options.cursor.id);
    const idIndex = values.length;
    where.push(`(taken_at < $${takenIndex} OR (taken_at = $${takenIndex} AND id < $${idIndex}::bigint))`);
  }

  values.push(options.limit + 1);
  const limitIndex = values.length;

  const { rows } = await options.pool.query<AssetRow>(
    `SELECT id, deriv_key, w, h, taken_at, camera, thumbhash, mime, path
     FROM asset
     WHERE ${where.join(' AND ')}
     ORDER BY taken_at DESC, id DESC
     LIMIT $${limitIndex}`,
    values,
  );

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    assets: pageRows.map((row) => toAssetItem(row, options.thumbBase, options.albumSlug)),
    nextCursor: hasMore && last ? encodeAssetCursor(last) : null,
  };
}
