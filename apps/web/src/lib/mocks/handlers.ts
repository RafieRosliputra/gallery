import { HttpResponse, http } from 'msw';
import type {
  AdminAlbumsResponse,
  AdminClientsResponse,
  AdminFolderView,
  AlbumResponse,
  AssetResponse,
  BucketPageResponse,
  ClientPortalResponse,
  LoginRequest,
  ResolveResponse
} from '@gallery/shared';
import {
  ADMIN_ALBUMS,
  ADMIN_BUCKETS,
  ADMIN_CLIENTS,
  ADMIN_MONTHS,
  ADMIN_STATUS,
  ALBUMS,
  BUCKETS_BY_ALBUM,
  ASSETS_BY_ALBUM,
  albumById,
  albumBySlug,
  albumDetail,
  assetById,
  clientBySlug,
  dayAssets,
  folderView
} from './fixtures';

const API = '*/s/api';

function json(body: object, status = 200) {
  return HttpResponse.json(body as Record<string, unknown>, { status });
}

function unauthorised() {
  return json({ error: 'unauthorised' }, 401);
}

/**
 * Mock-only session marker. The real server sets an httpOnly cookie in 1c;
 * the UI only observes the status endpoint, so both behave the same way.
 */
function isAdmin(): boolean {
  if (typeof document === 'undefined') return true;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .includes('gallery_admin=1');
}

export const handlers = [
  http.get(`${API}/resolve/:slug`, ({ params }) => {
    const slug = String(params.slug);
    if (clientBySlug(slug)) {
      const body: ResolveResponse = { kind: 'client', slug };
      return json(body);
    }
    if (albumBySlug(slug)) {
      const body: ResolveResponse = { kind: 'album', slug };
      return json(body);
    }
    return json({ error: 'not_found' }, 404);
  }),

  http.get(`${API}/client/:slug`, ({ params }) => {
    const client = clientBySlug(String(params.slug));
    if (!client) return json({ error: 'not_found' }, 404);
    const albums = ALBUMS.filter((album) => album.clientId === client.id);
    const body: ClientPortalResponse = {
      client,
      albums,
      albumCount: albums.length,
      assetCount: albums.reduce((sum, album) => sum + album.assetCount, 0)
    };
    return json(body);
  }),

  http.get(`${API}/album/:slug`, ({ params, request }) => {
    const album = albumBySlug(String(params.slug));
    if (!album) return json({ error: 'not_found' }, 404);
    const client = clientBySlug(album.clientSlug) ?? null;
    const buckets = (BUCKETS_BY_ALBUM.get(album.slug) ?? []).map((bucket) => ({ ...bucket }));
    const body: AlbumResponse = {
      album,
      client,
      buckets,
      cameras: album.cameras.map((camera, index) => ({
        camera,
        count: index === 0 ? Math.ceil(album.assetCount * 0.58) : album.assetCount - Math.ceil(album.assetCount * 0.58)
      }))
    };
    return json(body);
  }),

  http.get(`${API}/bucket/:key`, ({ params, request }) => {
    const url = new URL(request.url);
    const albumSlug = url.searchParams.get('album');
    const cam = url.searchParams.get('cam');
    const cursor = Number(url.searchParams.get('cursor') ?? '0') || 0;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '120') || 120, 120);
    const key = String(params.key);

    let items = albumSlug
      ? (ASSETS_BY_ALBUM.get(albumSlug)?.get(key) ?? [])
      : (dayAssets(key) ?? []);

    if (cam) items = items.filter((item) => item.camera === cam);
    const page = items.slice(cursor, cursor + limit);
    const body: BucketPageResponse = {
      items: page,
      nextCursor: cursor + limit < items.length ? String(cursor + limit) : null,
      total: items.length
    };
    return json(body);
  }),

  http.get(`${API}/asset/:id`, ({ params }) => {
    const asset = assetById(String(params.id));
    if (!asset) return json({ error: 'not_found' }, 404);
    const album = ALBUMS.find((candidate) => candidate.coverAssetIds.includes(asset.id)) ?? null;
    const body: AssetResponse = { asset, album };
    return json(body);
  }),

  http.post(`${API}/zip`, async () => {
    // Empty ZIP (EOCD only) — enough for UI/e2e; production streams originals.
    const zip = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ]);
    return new HttpResponse(zip, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="gallery.zip"' }
    });
  }),

  http.get(`${API}/admin/status`, () => (isAdmin() ? json(ADMIN_STATUS) : unauthorised())),

  http.post(`${API}/admin/login`, async ({ request }) => {
    const body = (await request.json()) as LoginRequest;
    if (body.username === 'rafi' && body.password === 'password') {
      if (typeof document !== 'undefined') {
        document.cookie = 'gallery_admin=1; path=/s; SameSite=Lax';
      }
      return json({ ok: true });
    }
    return json({ error: 'Nama pengguna atau kata laluan salah.' }, 401);
  }),

  http.post(`${API}/admin/rescan`, () => {
    if (!isAdmin()) return unauthorised();
    return json({ ok: true });
  }),

  http.post(`${API}/admin/logout`, () => {
    if (typeof document !== 'undefined') {
      document.cookie = 'gallery_admin=; path=/s; Max-Age=0; SameSite=Lax';
    }
    return json({ ok: true });
  }),

  http.get(`${API}/admin/albums`, () => {
    if (!isAdmin()) return unauthorised();
    const body: AdminAlbumsResponse = { albums: ADMIN_ALBUMS };
    return json(body);
  }),

  http.get(`${API}/admin/albums/:id`, ({ params }) => {
    if (!isAdmin()) return unauthorised();
    const detail = albumDetail(String(params.id));
    return detail ? json(detail) : json({ error: 'not_found' }, 404);
  }),

  http.post(`${API}/admin/albums`, async ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as Record<string, unknown>;
    const album = { ...ADMIN_ALBUMS[0], id: 'new-album', title: String(input.title ?? 'Album baru'), slug: String(input.slug ?? 'album-baru') };
    return json({ album });
  }),

  http.patch(`${API}/admin/albums/:id`, async ({ params, request }) => {
    if (!isAdmin()) return unauthorised();
    const album = albumById(String(params.id)) ?? ADMIN_ALBUMS[0];
    const input = (await request.json()) as Record<string, unknown>;
    return json({ album: { ...album, createdAt: '2026-11-01T00:00:00.000Z', ...input } });
  }),

  http.get(`${API}/admin/clients`, () => {
    if (!isAdmin()) return unauthorised();
    const body: AdminClientsResponse = { clients: ADMIN_CLIENTS };
    return json(body);
  }),

  http.post(`${API}/admin/clients`, async ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as { name?: string; slug?: string };
    const name = String(input.name ?? '').trim();
    const slug = String(input.slug ?? '').trim();
    if (!name || !slug) return json({ error: 'Nama dan slug diperlukan.' }, 400);
    const client = { id: `cl-${slug}`, name, slug, albumCount: 0, assetCount: 0, albums: [] };
    return json({ client });
  }),

  http.get(`${API}/admin/folders`, ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const path = new URL(request.url).searchParams.get('path') ?? 'CLIENT';
    const body: AdminFolderView = folderView(path);
    return json(body);
  }),

  http.get(`${API}/buckets`, ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const mode = new URL(request.url).searchParams.get('mode') ?? 'date';
    if (mode === 'folder') {
      return json({ buckets: [{ key: 'CLIENT', label: 'CLIENT', count: 3180 }], months: ADMIN_MONTHS });
    }
    return json({ buckets: ADMIN_BUCKETS, months: ADMIN_MONTHS });
  }),

  // Generated placeholder photos. Coloured gradients mirror the mock blocks;
  // no real client photography is committed (AGENTS §2.7).
  http.get(/\/s\/mock\/img\/.*/, ({ request }) => {
    const match = new URL(request.url).pathname.match(/\/s\/mock\/img\/([0-9a-f]{6})\/(\d+)\/(\d+)\.svg$/);
    if (!match) return new HttpResponse('not found', { status: 404 });
    const [, hex, w, h] = match;
    const n = parseInt(hex, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const light = `rgb(${Math.min(255, r + 34)},${Math.min(255, g + 34)},${Math.min(255, b + 34)})`;
    const dark = `rgb(${Math.max(0, r - 22)},${Math.max(0, g - 22)},${Math.max(0, b - 22)})`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="#${hex}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
    return new HttpResponse(svg, {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }
    });
  })
];
