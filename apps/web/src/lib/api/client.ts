import { base } from '$app/paths';
import type {
  AdminAlbumFolder,
  AdminFolderNode as WireFolderNode,
  AdminFolderTreeResponse,
  AdminSessionResponse,
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
  AdminFolderNode,
  AdminFolderView,
  AdminStatusView,
  AlbumCard,
  AlbumResponse,
  AlbumSaveRequest,
  Asset,
  AssetResponse,
  BucketPageResponse,
  BucketRef,
  ClientPortalResponse,
  CreateClientRequest,
  CreateClientResponse
} from './models';

const API = `${base}/api`;

const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

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
    ...(wire.original ? { original: wire.original } : {})
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
    sub: `${wire.count} gambar`
  };
}

interface AdminAlbumWire {
  id: string;
  clientId: string;
  title: string;
  slug: string;
  allowDownload: boolean;
  clientSlug: string;
  clientName: string;
  folderCount: number;
}

function toAdminAlbum(wire: AdminAlbumWire, detail: AlbumResponse | null): AdminAlbum {
  return {
    id: wire.id,
    title: wire.title,
    slug: wire.slug,
    clientId: wire.clientId,
    clientName: wire.clientName,
    clientSlug: wire.clientSlug,
    allowDownload: wire.allowDownload,
    assetCount: detail?.album.assetCount ?? 0,
    folderCount: wire.folderCount,
    coverAssetIds: detail?.album.coverAssetIds ?? [],
    covers: detail?.album.covers ?? [],
    cameras: detail?.album.cameras ?? [],
    takenAt: detail?.album.takenAt ?? null
  };
}

const albumDetailCache = new Map<string, AlbumResponse>();

async function albumDetail(slug: string, options: { cover?: boolean } = {}): Promise<AlbumResponse> {
  const key = `${slug}:${options.cover ? 'cover' : 'plain'}`;
  const cached = albumDetailCache.get(key);
  if (cached) return cached;

  const wire = await request<WireAlbumResponse>(`/album/${encodeURIComponent(slug)}`);
  const counts = await Promise.all(
    wire.cameras.map(async (camera) => {
      try {
        const filtered = await request<WireAlbumResponse>(
          `/album/${encodeURIComponent(slug)}${query({ cam: camera })}`
        );
        return { camera, count: filtered.total };
      } catch {
        return { camera, count: 0 };
      }
    })
  );

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
    total: wire.total
  };
  albumDetailCache.set(key, result);
  return result;
}

async function adminAlbums(): Promise<AdminAlbum[]> {
  const response = await request<{ albums: AdminAlbumWire[] }>('/admin/albums');
  return Promise.all(
    response.albums.map(async (album) => {
      let detail: AlbumResponse | null = null;
      try {
        detail = await albumDetail(album.slug, { cover: true });
      } catch {
        detail = null;
      }
      return toAdminAlbum(album, detail);
    })
  );
}

interface WireFolderTree extends AdminFolderTreeResponse {}

async function folderTree(): Promise<{ node: WireFolderNode; depth: number }[]> {
  const root = await request<WireFolderTree>('/admin/folders');
  const nodes: { node: WireFolderNode; depth: number }[] = [];
  const roots = root.folders.slice(0, 40);

  const expanded = await Promise.all(
    roots.map(async (folder) => {
      if (!folder.hasChildren) return [];
      try {
        const children = await request<WireFolderTree>(`/admin/folders${query({ parent: folder.id })}`);
        return children.folders;
      } catch {
        return [];
      }
    })
  );
  roots.forEach((folder, index) => {
    nodes.push({ node: folder, depth: 0 });
    for (const child of expanded[index] ?? []) nodes.push({ node: child, depth: 1 });
  });
  return nodes;
}

function uiFolder(node: WireFolderNode, depth: number, selectedIds: Set<string>): AdminFolderNode {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    depth,
    assetCount: node.assetCount,
    folderCount: node.hasChildren ? 1 : 0,
    hasChildren: node.hasChildren,
    selected: selectedIds.has(node.id)
  };
}

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

  async getAsset(id: string): Promise<AssetResponse> {
    const wire = await request<{ asset: WireAsset; album: WireAlbumCard | null }>(
      `/asset/${encodeURIComponent(id)}`
    );
    return {
      asset: toAsset(wire.asset),
      album: wire.album ? toAlbumCard(wire.album) : null
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
    if (!response.ok) throw new ApiError(response.status, response.statusText || 'ZIP gagal');
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
    const [albums, selected, clients, tree] = await Promise.all([
      adminAlbums(),
      request<{ folders: AdminAlbumFolder[] }>(`/admin/albums/${encodeURIComponent(id)}/folders`),
      request<{ clients: ClientSummary[] }>('/admin/clients'),
      folderTree()
    ]);
    const album = albums.find((candidate) => candidate.id === id);
    if (!album) throw new ApiError(404, 'Album tak dijumpai.');
    const selectedIds = new Set(selected.folders.map((folder) => folder.folderId));

    let previews: Asset[] = [];
    if (album.coverAssetIds.length === 0 && selected.folders[0]) {
      try {
        const page = await request<BucketResponse>(
          `/bucket/f:${encodeURIComponent(selected.folders[0].folderId)}${query({ limit: 4 })}`
        );
        previews = page.assets.map(toAsset);
      } catch {
        previews = [];
      }
    }
    return {
      album: { ...album, coverAssetIds: album.coverAssetIds, covers: previews.length ? previews : album.covers },
      folders: tree.map(({ node, depth }) => uiFolder(node, depth, selectedIds)),
      previews: previews.length ? previews : album.covers,
      totalAssets: album.assetCount,
      clients: clients.clients
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
          allowDownload: body.allowDownload
        })
      }
    );
    const albumId = response.album.id;
    let current: string[] = [];
    if (id) {
      const existing = await request<{ folders: AdminAlbumFolder[] }>(
        `/admin/albums/${encodeURIComponent(albumId)}/folders`
      );
      current = existing.folders.map((folder) => folder.folderId);
    }
    const wanted = new Set(body.folderIds);
    const toAdd = body.folderIds.filter((folderId) => !current.includes(folderId));
    const toRemove = current.filter((folderId) => !wanted.has(folderId));
    await Promise.all([
      ...toAdd.map((folderId) =>
        request(`/admin/albums/${encodeURIComponent(albumId)}/folders`, {
          method: 'POST',
          body: JSON.stringify({ folderId, recursive: true })
        })
      ),
      ...toRemove.map((folderId) =>
        request(`/admin/albums/${encodeURIComponent(albumId)}/folders/${encodeURIComponent(folderId)}`, {
          method: 'DELETE'
        })
      )
    ]);

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
    if (!current) throw new ApiError(404, 'Folder tak dijumpai.');

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
