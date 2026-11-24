/**
 * UI view models.
 *
 * The wire contract lives in `@gallery/shared` (owned by the API, phase 1c).
 * `$lib/api/client.ts` adapts that contract into these shapes so components do
 * not care about nullable dimensions, single-cover cards or month keys.
 */
import type { AdminStatusResponse, ClientSummary } from '@gallery/shared';

export interface Asset {
  id: string;
  w: number;
  h: number;
  thumbhash: string | null;
  thumbUrl: string;
  previewUrl: string;
  mime: string;
  takenAt: string | null;
  camera: string | null;
  original?: string;
}

export interface AlbumCard {
  id: string;
  title: string;
  slug: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  allowDownload: boolean;
  assetCount: number;
  folderCount: number;
  coverAssetIds: string[];
  covers: Asset[];
  cameras: string[];
  takenAt: string | null;
}

export interface CameraCount {
  camera: string;
  count: number;
}

export interface BucketRef {
  key: string;
  count: number;
  label?: string;
  sub?: string;
  year?: number;
  month?: number;
  monthLabel?: string;
}

export interface ClientPortalResponse {
  client: ClientSummary;
  albums: AlbumCard[];
  albumCount: number;
  assetCount: number;
}

export interface AlbumResponse {
  album: AlbumCard;
  client: ClientSummary;
  buckets: BucketRef[];
  cameras: CameraCount[];
  total: number;
}

export interface BucketPageResponse {
  items: Asset[];
  nextCursor: string | null;
  total?: number;
}

export interface AssetResponse {
  asset: Asset;
  album: AlbumCard | null;
}

// ---------------------------------------------------------------------------
// Admin view models
// ---------------------------------------------------------------------------

/** Base status plus optional dashboard extras 1c may add later. */
export interface AdminStatusView extends AdminStatusResponse {
  thumbsDone?: number;
  r2Done?: number;
  hotCache?: { usedBytes: number; capBytes: number };
  ram?: { freeBytes: number; totalBytes: number };
  faceSearch?: boolean;
  updatedAt?: string;
  log?: { at: string; message: string }[];
}

export interface AdminAlbum extends AlbumCard {
  createdAt?: string;
}

export interface AdminClient extends ClientSummary {
  albumCount: number;
  assetCount: number;
  albums: AdminAlbum[];
}

export interface AdminFolderNode {
  id: string;
  name: string;
  path: string;
  depth: number;
  assetCount: number;
  folderCount: number;
  hasChildren: boolean;
  selected?: boolean;
}

export interface AdminAlbumDetail {
  album: AdminAlbum;
  folders: AdminFolderNode[];
  previews: Asset[];
  totalAssets: number;
  clients: ClientSummary[];
}

export interface AdminFolderCard {
  id: string;
  name: string;
  path: string;
  assetCount: number;
  folderCount: number;
  hasChildren: boolean;
  coverAssetIds: string[];
  covers: Asset[];
  lastTakenAt: string | null;
}

export interface AdminTreeEntry {
  id: string;
  name: string;
  path: string;
  depth: number;
  assetCount: number;
  folderCount: number;
}

export interface AdminFolderView {
  id: string;
  path: string;
  breadcrumb: { id: string; name: string; path: string }[];
  tree: AdminTreeEntry[];
  folders: AdminFolderCard[];
  folderCount: number;
  assetCount: number;
  loose: Asset[];
}

export interface AdminBucketsResponse {
  buckets: BucketRef[];
}

export interface AlbumSaveRequest {
  clientId: string;
  title: string;
  slug: string;
  allowDownload: boolean;
  folderIds: string[];
}

export interface CreateClientRequest {
  name: string;
  slug: string;
}

export interface CreateClientResponse {
  client: AdminClient;
}
