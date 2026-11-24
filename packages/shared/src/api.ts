/**
 * Typed wire contract for the web UI (SPEC § API).
 *
 * Every endpoint lives under `/s/api`. The server (phase 1c) owns the
 * implementation; this file is the single shape both sides code against.
 * Fields marked optional are additive: the UI falls back when they are
 * absent. `ASSUME` notes mark shapes the SPEC does not spell out yet.
 */
import type { AdminStatusResponse } from './index.js';

export interface ClientRef {
  id: string;
  name: string;
  slug: string;
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
  /** Up to four covers, newest first. */
  coverAssetIds: string[];
  /** Resolved covers when the API has thumb URLs for them (ASSUME). */
  covers?: AssetItem[];
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

export interface AssetItem {
  id: string;
  w: number;
  h: number;
  thumbhash: string | null;
  thumbUrl: string;
  previewUrl: string;
  mime: string;
  takenAt: string | null;
  camera: string | null;
}

/** `GET /s/api/resolve/:slug` */
export type ResolveResponse =
  | { kind: 'client'; slug: string }
  | { kind: 'album'; slug: string };

/** `GET /s/api/client/:slug` */
export interface ClientPortalResponse {
  client: ClientRef;
  albums: AlbumCard[];
  albumCount: number;
  assetCount: number;
}

/** `GET /s/api/album/:slug?cam=` */
export interface AlbumResponse {
  album: AlbumCard;
  client: ClientRef | null;
  buckets: BucketRef[];
  cameras: CameraCount[];
}

/** `GET /s/api/bucket/:key?album=&cam=&cursor=&limit=` */
export interface BucketPageResponse {
  items: AssetItem[];
  nextCursor: string | null;
  total?: number;
}

/** `GET /s/api/asset/:id` (ASSUME: needed for direct `?p=` viewer links). */
export interface AssetResponse {
  asset: AssetItem;
  album: AlbumCard | null;
}

/** `POST /s/api/zip` */
export interface ZipRequest {
  albumSlug: string;
  ids?: string[];
  cam?: string;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** `POST /s/api/admin/login` */
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  ok: true;
}

/**
 * `GET /s/api/admin/status` plus dashboard cards the SPEC does not require
 * yet. All extras are optional so a 1c implementation can ship the base
 * contract first.
 */
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
  createdAt: string;
}

/** `GET /s/api/admin/albums` */
export interface AdminAlbumsResponse {
  albums: AdminAlbum[];
}

export interface AdminClient extends ClientRef {
  albumCount: number;
  assetCount: number;
  albums: AdminAlbum[];
}

/** `GET /s/api/admin/clients` */
export interface AdminClientsResponse {
  clients: AdminClient[];
}

/** `POST /s/api/admin/clients` (ASSUME). */
export interface CreateClientRequest {
  name: string;
  slug: string;
}

export interface CreateClientResponse {
  client: AdminClient;
}

export interface AdminFolderNode {
  id: string;
  name: string;
  path: string;
  depth: number;
  assetCount: number;
  folderCount: number;
  selected?: boolean;
}

/** `GET /s/api/admin/albums/:id` */
export interface AdminAlbumDetail {
  album: AdminAlbum;
  folders: AdminFolderNode[];
  previews: AssetItem[];
  totalAssets: number;
  clients: ClientRef[];
}

/** `GET /s/api/admin/folders?path=` */
export interface AdminFolderCard {
  id: string;
  name: string;
  path: string;
  assetCount: number;
  folderCount: number;
  coverAssetIds: string[];
  covers?: AssetItem[];
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
  path: string;
  breadcrumb: { name: string; path: string }[];
  tree: AdminTreeEntry[];
  folders: AdminFolderCard[];
  folderCount: number;
  assetCount: number;
  loose: AssetItem[];
}

/** `GET /s/api/buckets?mode=date|folder` */
export interface AdminBucketsResponse {
  buckets: BucketRef[];
  /** Year/month jump list; omit to derive from buckets. */
  months?: { year: number; months: { key: string; label: string }[] }[];
}

/** `POST/PATCH /s/api/admin/albums(/:id)` (ASSUME). */
export interface AlbumSaveRequest {
  clientId: string;
  title: string;
  slug: string;
  allowDownload: boolean;
  folderIds: string[];
}

export interface AlbumSaveResponse {
  album: AdminAlbum;
}

/** `GET /s/api/admin/session` (ASSUME: used only to pick login vs admin). */
export interface SessionResponse {
  admin: boolean;
}
