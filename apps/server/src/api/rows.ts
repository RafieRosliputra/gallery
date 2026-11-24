import type { AssetItem } from '@gallery/shared';
import { originalUrl, thumbUrl } from './urls.js';

export interface AssetRow {
  id: string;
  deriv_key: string;
  w: number | null;
  h: number | null;
  /** pg returns Date; JSON aggregates over the same column return an ISO string. */
  taken_at: Date | string | null;
  camera: string | null;
  thumbhash: string | null;
  mime: string;
}

export function toAssetItem(row: AssetRow, thumbBase: string, albumSlug?: string): AssetItem {
  const item: AssetItem = {
    id: row.id,
    w: row.w,
    h: row.h,
    takenAt: row.taken_at ? new Date(row.taken_at).toISOString() : null,
    camera: row.camera,
    thumbhash: row.thumbhash,
    mime: row.mime,
    thumb: thumbUrl(thumbBase, row.deriv_key, '300'),
    preview: thumbUrl(thumbBase, row.deriv_key, '1600'),
  };
  if (albumSlug) item.original = originalUrl(row.id, albumSlug);
  return item;
}
