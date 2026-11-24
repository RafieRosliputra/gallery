import { base } from '$app/paths';
import type {
  AdminAlbumDetail,
  AdminAlbumsResponse,
  AdminBucketsResponse,
  AdminClientsResponse,
  AdminFolderView,
  AdminStatusView,
  AlbumResponse,
  AlbumSaveRequest,
  CreateClientRequest,
  CreateClientResponse,
  AlbumSaveResponse,
  AssetResponse,
  BucketPageResponse,
  ClientPortalResponse,
  LoginResponse,
  ResolveResponse,
  ZipRequest
} from '@gallery/shared';

const API = `${base}/api`;

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
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
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

export const api = {
  resolve(slug: string) {
    return request<ResolveResponse>(`/resolve/${encodeURIComponent(slug)}`);
  },

  getClient(slug: string) {
    return request<ClientPortalResponse>(`/client/${encodeURIComponent(slug)}`);
  },

  getAlbum(slug: string, cam?: string | null) {
    return request<AlbumResponse>(`/album/${encodeURIComponent(slug)}${query({ cam })}`);
  },

  getBucket(
    key: string,
    options: { album?: string; cam?: string | null; cursor?: string | null; limit?: number } = {}
  ) {
    return request<BucketPageResponse>(
      `/bucket/${encodeURIComponent(key)}${query({
        album: options.album,
        cam: options.cam,
        cursor: options.cursor,
        limit: options.limit
      })}`
    );
  },

  getAsset(id: string) {
    return request<AssetResponse>(`/asset/${encodeURIComponent(id)}`);
  },

  originalUrl(id: string) {
    return `${API}/o/${encodeURIComponent(id)}`;
  },

  async zip(body: ZipRequest): Promise<Blob> {
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

  rescan() {
    return request<{ ok: boolean }>('/admin/rescan', { method: 'POST' });
  },

  login(username: string, password: string) {
    return request<LoginResponse>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  logout() {
    return request<{ ok: boolean }>('/admin/logout', { method: 'POST' });
  },

  getAdminAlbums() {
    return request<AdminAlbumsResponse>('/admin/albums');
  },

  getAdminAlbum(id: string) {
    return request<AdminAlbumDetail>(`/admin/albums/${encodeURIComponent(id)}`);
  },

  saveAlbum(id: string | null, body: AlbumSaveRequest) {
    return request<AlbumSaveResponse>(id ? `/admin/albums/${encodeURIComponent(id)}` : '/admin/albums', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
  },

  getAdminClients() {
    return request<AdminClientsResponse>('/admin/clients');
  },

  createClient(body: CreateClientRequest) {
    return request<CreateClientResponse>('/admin/clients', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  getAdminFolder(path: string) {
    return request<AdminFolderView>(`/admin/folders${query({ path })}`);
  },

  getAdminBuckets(mode: 'date' | 'folder') {
    return request<AdminBucketsResponse>(`/buckets${query({ mode })}`);
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
