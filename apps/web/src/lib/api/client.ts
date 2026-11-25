import { base } from '$app/paths';
import type {
  AdminAlbumFolder,
  AdminFolderNode as WireFolderNode,
  AdminFolderTreeResponse,
  AdminSessionResponse,
  AlbumFolderResponse,
  ScopeStats,
  AdminStatusResponse,
  AlbumCard as WireAlbumCard,
  AlbumResponse as WireAlbumResponse,
  AssetItem as WireAsset,
  BucketResponse,
  BucketSummary,
  ClientResponse,
  ClientSummary,
  ResolveResponse
} from '@gallery/shared';
import type {
  AdminAlbum,
  AdminAlbumDetail,
  AdminBucketsResponse,
  AdminClient,
  AdminFolderCard,
  AdminFolderView,
  AdminStatusView,
  AlbumCard,
  AlbumFolderView,
  AlbumResponse,
  ClientAlbum,
  AlbumSaveRequest,
  FolderMoveEntry,
  FolderRule,
  PickerFolder,
  ThumbProgress,
  Asset,
  AssetResponse,
  BucketPageResponse,
  BucketRef,
  ClientPortalResponse,
  CreateClientRequest,
  CreateClientResponse
} from './models';

const API = `${base}/api`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isUnauthorised(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function toAsset(wire: WireAsset): Asset {
  return {
    id: wire.id,
    w: wire.w && wire.w > 0 ? wire.w : 4,
    h: wire.h && wire.h > 0 ? wire.h : 3,
    thumbhash: wire.thumbhash,
    thumbUrl: wire.thumb,
    previewUrl: wire.preview,
    mime: wire.mime,
    takenAt: wire.takenAt,
    camera: wire.camera,
    ...(wire.original ? { original: wire.original } : {}),
    ...(wire.name ? { name: wire.name } : {})
  };
}

type WireAlbumCardExtra = WireAlbumCard & {
  covers?: WireAsset[];
  cameras?: string[];
  folderCount?: number;
  takenAt?: string | null;
  clientName?: string;
  clientSlug?: string;
};

function toAlbumCard(
  wire: WireAlbumCardExtra,
  client?: ClientSummary | null,
  detail?: AlbumResponse | null
): AlbumCard {
  const covers = wire.covers?.length
    ? wire.covers.map(toAsset)
    : detail?.album.covers.length
      ? detail.album.covers
      : wire.cover
        ? [toAsset(wire.cover)]
        : [];
  return {
    id: wire.id,
    title: wire.title,
    slug: wire.slug,
    clientId: wire.clientId,
    clientName: wire.clientName ?? client?.name ?? '',
    clientSlug: wire.clientSlug ?? client?.slug ?? '',
    allowDownload: wire.allowDownload,
    description: wire.description ?? '',
    assetCount: wire.count || detail?.album.assetCount || 0,
    folderCount: wire.folderCount ?? detail?.album.folderCount ?? 0,
    coverAssetIds: covers.map((cover) => cover.id),
    covers,
    cameras: wire.cameras ?? detail?.album.cameras ?? [],
    takenAt: wire.takenAt ?? detail?.album.takenAt ?? covers[0]?.takenAt ?? null
  };
}

function toBucket(wire: BucketSummary): BucketRef {
  const match = /^(\d{4})-(\d{2})$/.exec(wire.key);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    return {
      key: wire.key,
      count: wire.count,
      label: wire.label ?? `${MONTHS[month - 1] ?? ''} ${year}`,
      year,
      month,
      monthLabel: MONTHS[month - 1] ?? ''
    };
  }
  return {
    key: wire.key,
    count: wire.count,
    label: wire.label ?? wire.key,
    sub: `${wire.count} photos`
  };
}

interface AdminAlbumWire {
  id: string;
  clientId: string;
  title: string;
  slug: string;
  allowDownload: boolean;
  description?: string;
  sort?: 'name' | 'taken' | 'taken_desc';
  clientSlug: string;
  clientName: string;
  folderCount: number;
  count: number;
  cameras: string[];
  covers: WireAsset[];
}

function toAdminAlbum(wire: AdminAlbumWire, detail: AlbumResponse | null): AdminAlbum {
  const covers = wire.covers?.length
    ? wire.covers.map(toAsset)
    : (detail?.album.covers ?? []);
  return {
    id: wire.id,
    title: wire.title,
    slug: wire.slug,
    clientId: wire.clientId,
    clientName: wire.clientName,
    clientSlug: wire.clientSlug,
    ...(wire.sort ? { sort: wire.sort } : {}),
    allowDownload: wire.allowDownload,
    description: wire.description ?? '',
    assetCount: wire.count || detail?.album.assetCount || 0,
    folderCount: wire.folderCount,
    coverAssetIds: covers.map((cover) => cover.id),
    covers,
    cameras: wire.cameras?.length ? wire.cameras : detail?.album.cameras ?? [],
    takenAt: covers[0]?.takenAt ?? detail?.album.takenAt ?? null
  };
}

const albumDetailCache = new Map<string, AlbumResponse>();

async function albumDetail(slug: string, options: { cover?: boolean } = {}): Promise<AlbumResponse> {
  const key = `${slug}:${options.cover ? 'cover' : 'plain'}`;
  const cached = albumDetailCache.get(key);
  if (cached) return cached;

  const wire = await request<WireAlbumResponse>(`/album/${encodeURIComponent(slug)}`);
  // Camera tabs are gone (albums navigate by folder); no per-camera fan-out.
  const counts = wire.cameras.map((camera) => ({ camera, count: 0 }));

  let covers: Asset[] = [];
  if (options.cover && wire.buckets[0]) {
    try {
      const page = await request<BucketResponse>(
        `/bucket/${encodeURIComponent(wire.buckets[0].key)}${query({
          album: slug,
          limit: 4
        })}`
      );
      covers = page.assets.map(toAsset);
    } catch {
      covers = [];
    }
  }

  const album: AlbumCard = {
    id: wire.album.id,
    title: wire.album.title,
    slug: wire.album.slug,
    clientId: wire.album.clientId,
    clientName: wire.client.name,
    clientSlug: wire.client.slug,
    allowDownload: wire.album.allowDownload,
    description: wire.album.description ?? '',
    assetCount: wire.total,
    folderCount: 0,
    coverAssetIds: covers.map((cover) => cover.id),
    covers,
    cameras: wire.cameras,
    takenAt: covers[0]?.takenAt ?? null
  };

  const result: AlbumResponse = {
    album,
    client: wire.client,
    buckets: wire.buckets.map(toBucket),
    cameras: counts,
    total: wire.total,
    viewerIsAdmin: Boolean(wire.viewerIsAdmin)
  };
  albumDetailCache.set(key, result);
  return result;
}

async function adminAlbums(): Promise<AdminAlbum[]> {
  // The list endpoint carries count, cameras and covers already; no per-album
  // fan-out (apps/server/src/api/admin.ts is one statement).
  const response = await request<{ albums: AdminAlbumWire[] }>('/admin/albums');
  return response.albums.map((album) => toAdminAlbum(album, null));
}

interface WireFolderTree extends AdminFolderTreeResponse {}

async function adminClients(): Promise<AdminClient[]> {
  const [clients, albums] = await Promise.all([
    request<{ clients: { id: string; name: string; slug: string; albumCount: number }[] }>('/admin/clients'),
    adminAlbums()
  ]);
  return clients.clients.map((client) => {
    const owned = albums.filter((album) => album.clientId === client.id);
    return {
      ...client,
      assetCount: owned.reduce((sum, album) => sum + album.assetCount, 0),
      albums: owned
    };
  });
}

export const api = {
  resolve(slug: string) {
    return request<ResolveResponse>(`/resolve/${encodeURIComponent(slug)}`);
  },

  async getClient(slug: string): Promise<ClientPortalResponse> {
    const wire = await request<ClientResponse>(`/client/${encodeURIComponent(slug)}`);
    const albums = await Promise.all(
      wire.albums.map(async (album) => {
        let detail: AlbumResponse | null = null;
        try {
          detail = await albumDetail(album.slug, { cover: true });
        } catch {
          detail = null;
        }
        return toAlbumCard(album as WireAlbumCardExtra, wire.client, detail);
      })
    );
    return {
      client: wire.client,
      albums,
      albumCount: albums.length,
      assetCount: albums.reduce((sum, album) => sum + album.assetCount, 0)
    };
  },

  getAlbum(slug: string, options: { cover?: boolean } = {}) {
    return albumDetail(slug, options);
  },

  async getBucket(
    key: string,
    options: { album?: string; cam?: string | null; cursor?: string | null; limit?: number } = {}
  ): Promise<BucketPageResponse> {
    const page = await request<BucketResponse>(
      `/bucket/${encodeURIComponent(key)}${query({
        album: options.album,
        cam: options.cam,
        cursor: options.cursor,
        limit: options.limit
      })}`
    );
    return { items: page.assets.map(toAsset), nextCursor: page.nextCursor };
  },

  async getAsset(id: string, albumSlug?: string): Promise<AssetResponse> {
    const wire = await request<{ asset: WireAsset; albumSlug: string | null }>(
      `/asset/${encodeURIComponent(id)}${query({ album: albumSlug })}`
    );
    return {
      asset: toAsset(wire.asset),
      albumSlug: wire.albumSlug
    };
  },

  originalUrl(id: string, albumSlug?: string) {
    return `${API}/o/${encodeURIComponent(id)}${albumSlug ? `?album=${encodeURIComponent(albumSlug)}` : ''}`;
  },

  async zip(body: { albumSlug: string; ids?: string[]; cam?: string }): Promise<Blob> {
    const response = await fetch(`${API}/zip`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new ApiError(response.status, response.statusText || 'ZIP failed');
    return response.blob();
  },

  getAdminStatus() {
    return request<AdminStatusView>('/admin/status');
  },

  getSession() {
    return request<AdminSessionResponse>('/auth/session');
  },

  login(username: string, password: string) {
    return request<AdminSessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  getAdminAlbums(): Promise<AdminAlbum[]> {
    return adminAlbums();
  },

  async getAdminAlbum(id: string): Promise<AdminAlbumDetail> {
    const [albums, selected, clients] = await Promise.all([
      adminAlbums(),
      request<{ folders: AdminAlbumFolder[] }>(`/admin/albums/${encodeURIComponent(id)}/folders`),
      request<{ clients: ClientSummary[] }>('/admin/clients')
    ]);
    const album = albums.find((candidate) => candidate.id === id);
    if (!album) throw new ApiError(404, 'Album not found.');
    return {
      album,
      rules: selected.folders.map((folder) => ({
        folderId: folder.folderId,
        path: folder.path,
        included: folder.included
      })),
      previews: album.covers,
      totalAssets: album.assetCount,
      clients: clients.clients
    };
  },

  async getFolderChildren(parentId?: string): Promise<{ parent: PickerFolder | null; folders: PickerFolder[] }> {
    const wire = await request<AdminFolderTreeResponse>(`/admin/folders${query({ parent: parentId })}`);
    const picker = (node: WireFolderNode): PickerFolder => ({
      id: node.id,
      name: node.name,
      path: node.path,
      totalCount: node.totalCount ?? node.assetCount,
      hasChildren: node.hasChildren
    });
    return { parent: wire.parent ? picker(wire.parent) : null, folders: wire.folders.map(picker) };
  },

  getClientAlbums(clientId: string): Promise<{ client: ClientSummary; albums: ClientAlbum[] }> {
    return request<{ client: ClientSummary; albums: ClientAlbum[] }>(`/admin/clients/${encodeURIComponent(clientId)}/albums`);
  },

  async createFolderAlbum(clientId: string, folderId: string): Promise<ClientAlbum> {
    const response = await request<{ album: ClientAlbum }>(`/admin/clients/${encodeURIComponent(clientId)}/albums`, {
      method: 'POST',
      body: JSON.stringify({ folderId })
    });
    albumDetailCache.clear();
    return response.album;
  },

  async saveAlbumRules(albumId: string, rules: FolderRule[]): Promise<ScopeStats> {
    const response = await request<ScopeStats>(`/admin/albums/${encodeURIComponent(albumId)}/folders`, {
      method: 'PUT',
      body: JSON.stringify({ rules: rules.map(({ folderId, included }) => ({ folderId, included })) })
    });
    albumDetailCache.clear();
    return response;
  },

  async updateAlbumSettings(
    albumId: string,
    body: { title?: string; slug?: string; allowDownload?: boolean; description?: string }
  ): Promise<void> {
    await request(`/admin/albums/${encodeURIComponent(albumId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    albumDetailCache.clear();
  },

  updateClient(
    id: string,
    body: { name?: string; slug?: string; description?: string }
  ): Promise<{ client: ClientSummary }> {
    return request<{ client: ClientSummary }>(`/admin/clients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  },

  getAlbumThumbs(id: string): Promise<ThumbProgress> {
    return request<ThumbProgress>(`/admin/albums/${encodeURIComponent(id)}/thumbs`);
  },

  forceAlbumThumbs(id: string): Promise<{ queued: number }> {
    return request<{ queued: number }>(`/admin/albums/${encodeURIComponent(id)}/thumbs`, { method: 'POST' });
  },

  async deleteAlbum(id: string): Promise<void> {
    await request<void>(`/admin/albums/${encodeURIComponent(id)}`, { method: 'DELETE' });
    albumDetailCache.clear();
  },

  async deleteClient(id: string): Promise<void> {
    await request<void>(`/admin/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
    albumDetailCache.clear();
  },

  async getMoves(): Promise<FolderMoveEntry[]> {
    return (await request<{ moves: FolderMoveEntry[] }>('/admin/moves')).moves;
  },

  previewScope(rules: FolderRule[]): Promise<ScopeStats> {
    return request<ScopeStats>('/admin/scope-preview', {
      method: 'POST',
      body: JSON.stringify({ rules: rules.map(({ folderId, included }) => ({ folderId, included })) })
    });
  },

  async getAlbumFolders(slug: string, folderId?: string | null): Promise<AlbumFolderView> {
    const wire = await request<AlbumFolderResponse>(
      `/album/${encodeURIComponent(slug)}/folders${query({ folder: folderId })}`
    );
    return {
      folderId: wire.folderId,
      trail: wire.trail,
      folders: wire.folders.map((card) => ({
        id: card.id,
        name: card.name,
        count: card.count,
        cover: card.cover ? toAsset(card.cover) : null
      })),
      assetCount: wire.assetCount
    };
  },

  async saveAlbum(id: string | null, body: AlbumSaveRequest): Promise<{ album: AdminAlbum }> {
    const response = await request<{ album: AdminAlbumWire }>(
      id ? `/admin/albums/${encodeURIComponent(id)}` : '/admin/albums',
      {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          clientId: body.clientId,
          title: body.title,
          slug: body.slug,
          allowDownload: body.allowDownload,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.sort ? { sort: body.sort } : {})
        })
      }
    );
    const albumId = response.album.id;
    await request(`/admin/albums/${encodeURIComponent(albumId)}/folders`, {
      method: 'PUT',
      body: JSON.stringify({ rules: body.rules.map(({ folderId, included }) => ({ folderId, included })) })
    });

    albumDetailCache.clear();
    let detail: AlbumResponse | null = null;
    try {
      detail = await albumDetail(response.album.slug, { cover: true });
    } catch {
      detail = null;
    }
    return { album: toAdminAlbum(response.album, detail) };
  },

  getAdminClients(): Promise<AdminClient[]> {
    return adminClients();
  },

  async createClient(body: CreateClientRequest): Promise<CreateClientResponse> {
    const response = await request<{ client: ClientSummary }>('/admin/clients', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return {
      client: { ...response.client, albumCount: 0, assetCount: 0, albums: [] }
    };
  },

  async getAdminFolder(id?: string): Promise<AdminFolderView> {
    const root = await request<WireFolderTree>('/admin/folders');
    let currentResponse: WireFolderTree;
    if (id) {
      currentResponse = await request<WireFolderTree>(`/admin/folders${query({ parent: id })}`);
    } else {
      const clientFolder = root.folders.find((folder) => folder.name.toLowerCase() === 'client');
      currentResponse = clientFolder
        ? await request<WireFolderTree>(`/admin/folders${query({ parent: clientFolder.id })}`)
        : root;
    }
    const current = currentResponse.parent;
    if (!current) throw new ApiError(404, 'Folder not found.');

    const breadcrumb: { id: string; name: string; path: string }[] = [];
    let cursor: WireFolderNode | null = current;
    while (cursor) {
      breadcrumb.unshift({
        id: cursor.id,
        name: cursor.path === '.' ? 'studio' : cursor.name,
        path: cursor.path
      });
      if (!cursor.parentId) break;
      const parentResponse: WireFolderTree = await request<WireFolderTree>(
        `/admin/folders${query({ parent: cursor.parentId })}`
      );
      cursor = parentResponse.parent;
    }

    const folders = await Promise.all(
      currentResponse.folders.map(async (folder) => {
        let covers: Asset[] = [];
        try {
          const page = await request<BucketResponse>(
            `/bucket/f:${encodeURIComponent(folder.id)}${query({ limit: 4 })}`
          );
          covers = page.assets.map(toAsset);
        } catch {
          covers = [];
        }
        return {
          id: folder.id,
          name: folder.name,
          path: folder.path,
          assetCount: folder.assetCount,
          folderCount: folder.hasChildren ? 1 : 0,
          hasChildren: folder.hasChildren,
          coverAssetIds: covers.map((cover) => cover.id),
          covers,
          lastTakenAt: covers[0]?.takenAt ?? null
        } satisfies AdminFolderCard;
      })
    );

    let loose: Asset[] = [];
    try {
      const page = await request<BucketResponse>(
        `/bucket/f:${encodeURIComponent(current.id)}${query({ limit: 24 })}`
      );
      loose = page.assets.map(toAsset);
    } catch {
      loose = [];
    }

    const tree: AdminFolderView['tree'] = [];
    for (const folder of root.folders) {
      tree.push({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        depth: 0,
        assetCount: folder.assetCount,
        folderCount: folder.hasChildren ? 1 : 0
      });
      if (folder.id === current.id) {
        for (const child of currentResponse.folders) {
          tree.push({
            id: child.id,
            name: child.name,
            path: child.path,
            depth: 1,
            assetCount: child.assetCount,
            folderCount: child.hasChildren ? 1 : 0
          });
        }
      }
    }

    return {
      id: current.id,
      path: current.path,
      breadcrumb,
      tree,
      folders,
      folderCount: currentResponse.folders.length,
      assetCount: current.assetCount,
      loose
    };
  },

  async getAdminBuckets(mode: 'date' | 'folder'): Promise<AdminBucketsResponse> {
    const response = await request<{ buckets: BucketSummary[] }>(`/admin/buckets${query({ mode })}`);
    return { buckets: response.buckets.map(toBucket) };
  },

  rescan() {
    return request<{ started: boolean }>('/admin/rescan', { method: 'POST' });
  }
};

/** Triggers a same-tab download for a blob response. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
