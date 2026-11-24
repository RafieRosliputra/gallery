/** Slug format shared by client and album links: `[a-z0-9-]{3,60}` (SPEC § Data model). */
export const SLUG_PATTERN = '^[a-z0-9-]{3,60}$';
export const SLUG_REGEX = new RegExp(SLUG_PATTERN);

/** Response body of `GET /s/api/health`. */
export interface HealthResponse {
  ok: boolean;
  version: string;
  db: 'up' | 'down';
}

/** Response body of `GET /s/api/admin/status`. */
export interface AdminStatusResponse {
  assets: number;
  pendingThumbs: number;
  /** 0 when R2 is disabled (`R2_MODE=off`). */
  pendingR2: number;
  r2Enabled: boolean;
  lastScanAt: string | null;
  errors24h: number;
}

export interface AdminSessionResponse {
  admin: { id: string; username: string };
}

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
}

export interface AlbumSummary {
  id: string;
  clientId: string;
  title: string;
  slug: string;
  allowDownload: boolean;
}

/** URLs are absolute paths (or a CDN URL when THUMB_BASE is absolute). */
export interface DerivativeUrls {
  thumb: string;
  preview: string;
}

export interface AssetItem extends DerivativeUrls {
  id: string;
  w: number | null;
  h: number | null;
  takenAt: string | null;
  camera: string | null;
  thumbhash: string | null;
  mime: string;
  /** Only present on public endpoints that know the album scope. */
  original?: string;
}

export interface BucketSummary {
  /** `YYYY-MM` for date buckets, `f:<folderId>` for folder buckets. */
  key: string;
  label?: string;
  count: number;
}

export type ResolveResponse =
  | { kind: 'client'; client: ClientSummary }
  | { kind: 'album'; album: AlbumSummary; client: ClientSummary };

export interface AlbumCard extends AlbumSummary {
  count: number;
  cover: AssetItem | null;
}

export interface ClientResponse {
  client: ClientSummary;
  albums: AlbumCard[];
}

export interface AlbumResponse {
  album: AlbumSummary;
  client: ClientSummary;
  cameras: string[];
  buckets: BucketSummary[];
  total: number;
  /** Prefix used to build derivative URLs, e.g. `/s/t`. */
  thumbBase: string;
  /** The request carries an admin session (shows admin-only tools). */
  viewerIsAdmin?: boolean;
}

export interface BucketResponse {
  assets: AssetItem[];
  nextCursor: string | null;
}

/** Response body of `GET /s/api/asset/:id?album=`. */
export interface AssetLookupResponse {
  asset: AssetItem;
  /** Album used for the scope check; `null` for an admin request without `album`. */
  albumSlug: string | null;
}

export interface AdminFolderNode {
  id: string;
  path: string;
  name: string;
  parentId: string | null;
  assetCount: number;
  /** Assets in the folder and all of its subfolders. */
  totalCount: number;
  hasChildren: boolean;
}

export interface AdminFolderTreeResponse {
  parent: AdminFolderNode | null;
  folders: AdminFolderNode[];
}

export interface AdminAlbumFolder {
  folderId: string;
  path: string;
  recursive: boolean;
  /** false = this subtree is carved out of an included parent. */
  included: boolean;
}

/** One include/exclude rule sent by the album editor. */
export interface AlbumRule {
  folderId: string;
  included: boolean;
}

export interface ScopeStats {
  assetCount: number;
  folderCount: number;
}

export interface AlbumFolderCard {
  id: string;
  name: string;
  /** Assets in this folder and its in-album subfolders. */
  count: number;
  cover: AssetItem | null;
}

/** Response body of `GET /s/api/album/:slug/folders?folder=`. */
export interface AlbumFolderResponse {
  /** Folder whose own photos are listed below the cards; null at a multi-root album top. */
  folderId: string | null;
  /** Breadcrumb from the album top to the current folder (album top itself excluded). */
  trail: { id: string; name: string }[];
  folders: AlbumFolderCard[];
  /** Photos directly inside `folderId`. */
  assetCount: number;
}

/** Error body used by every JSON endpoint. */
export interface ApiError {
  error: string;
  message: string;
}
