import { HttpResponse, http } from 'msw';
import type {
  AdminFolderTreeResponse,
  AdminSessionResponse,
  AlbumFolderResponse,
  AlbumResponse,
  AlbumSummary,
  BucketResponse,
  ClientResponse,
  ResolveResponse,
  AssetItem
} from '@gallery/shared';
import {
  ADMIN_ALBUMS,
  ADMIN_BUCKETS,
  ADMIN_CLIENTS,
  ADMIN_STATUS,
  ALBUM_FOLDER_IDS,
  ALBUMS,
  ASSETS_BY_ALBUM,
  BUCKETS_BY_ALBUM,
  albumById,
  albumBySlug,
  adminMonthAssets,
  assetById,
  cameraTotal,
  clientBySlug,
  folderAssets,
  folderChildren,
  folderNode
} from './fixtures';

const API = '*/s/api';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function json(body: object, status = 200) {
  return HttpResponse.json(body as Record<string, unknown>, { status });
}

function unauthorised() {
  return json({ error: 'unauthorized', message: 'Session is invalid or has expired.' }, 401);
}

function isAdmin(): boolean {
  if (typeof document === 'undefined') return true;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .includes('gallery_admin=1');
}

function albumSummary(album: (typeof ALBUMS)[number]): AlbumSummary {
  return {
    id: album.id,
    clientId: album.clientId,
    title: album.title,
    slug: album.slug,
    allowDownload: album.allowDownload
  };
}

function albumResponse(album: (typeof ALBUMS)[number], cam: string | null): AlbumResponse {
  const buckets = BUCKETS_BY_ALBUM.get(album.slug) ?? [];
  const ratio = album.count > 0 ? cameraTotal(album, cam ?? '') / album.count : 0;
  const filtered = cam
    ? buckets.map((bucket) => ({ ...bucket, count: Math.max(1, Math.round(bucket.count * ratio)) }))
    : buckets.map((bucket) => ({ ...bucket }));
  return {
    album: albumSummary(album),
    client: { id: album.clientId, name: album.clientName, slug: album.clientSlug },
    cameras: album.cameras,
    buckets: filtered,
    total: cam ? cameraTotal(album, cam) : album.count,
    thumbBase: '/s/t'
  };
}

function pageOf(assets: ReturnType<typeof folderAssets>, cursorRaw: string | null, limitRaw: string | null) {
  const cursor = Number(cursorRaw ?? '0') || 0;
  const limit = Math.min(Number(limitRaw ?? '120') || 120, 120);
  const page = assets.slice(cursor, cursor + limit);
  return { page, nextCursor: cursor + limit < assets.length ? String(cursor + limit) : null };
}

/** Mock albums navigate by camera folders: folder N = camera N, folder 0 = the whole album. */
function albumAssets(album: (typeof ALBUMS)[number], folder: number): AssetItem[] {
  const all = [...(ASSETS_BY_ALBUM.get(album.slug)?.values() ?? [])].flat();
  if (folder === 0) return all;
  const camera = album.cameras[folder - 1];
  return all.filter((asset) => asset.camera === camera);
}

function albumFolders(album: (typeof ALBUMS)[number], folder: string | null): AlbumFolderResponse | null {
  if (album.cameras.length < 2) {
    if (folder && folder !== '0') return null;
    return { folderId: '0', trail: [], folders: [], assetCount: album.count };
  }
  if (!folder) {
    return {
      folderId: null,
      trail: [],
      folders: album.cameras.map((camera, index) => ({
        id: String(index + 1),
        name: camera,
        count: cameraTotal(album, camera),
        cover: albumAssets(album, index + 1)[0] ?? null
      })),
      assetCount: 0
    };
  }
  const index = Number(folder);
  const camera = album.cameras[index - 1];
  if (!camera) return null;
  return { folderId: folder, trail: [{ id: folder, name: camera }], folders: [], assetCount: cameraTotal(album, camera) };
}

export const handlers = [
  http.get(`${API}/resolve/:slug`, ({ params }) => {
    const slug = String(params.slug);
    const client = clientBySlug(slug);
    if (client) {
      const body: ResolveResponse = { kind: 'client', client };
      return json(body);
    }
    const album = albumBySlug(slug);
    if (album) {
      const body: ResolveResponse = {
        kind: 'album',
        album: albumSummary(album),
        client: { id: album.clientId, name: album.clientName, slug: album.clientSlug }
      };
      return json(body);
    }
    return json({ error: 'not_found', message: 'Link not found.' }, 404);
  }),

  http.get(`${API}/client/:slug`, ({ params }) => {
    const client = clientBySlug(String(params.slug));
    if (!client) return json({ error: 'not_found', message: 'Client not found.' }, 404);
    const body: ClientResponse = {
      client,
      albums: ALBUMS.filter((album) => album.clientId === client.id)
    };
    return json(body);
  }),

  http.get(`${API}/album/:slug`, ({ params, request }) => {
    const album = albumBySlug(String(params.slug));
    if (!album) return json({ error: 'not_found', message: 'Album not found.' }, 404);
    const cam = new URL(request.url).searchParams.get('cam');
    return json(albumResponse(album, cam));
  }),

  http.get(`${API}/album/:slug/folders`, ({ params, request }) => {
    const album = albumBySlug(String(params.slug));
    if (!album) return json({ error: 'not_found', message: 'Album not found.' }, 404);
    const view = albumFolders(album, new URL(request.url).searchParams.get('folder'));
    if (!view) return json({ error: 'not_found', message: 'Folder not found.' }, 404);
    return json(view);
  }),

  http.get(`${API}/bucket/:key`, ({ params, request }) => {
    const url = new URL(request.url);
    const albumSlug = url.searchParams.get('album');
    const cam = url.searchParams.get('cam');
    const key = String(params.key);
    const cursorRaw = url.searchParams.get('cursor');
    const limitRaw = url.searchParams.get('limit');

    if (!MONTH.test(key) && !/^f:\d+$/.test(key)) {
      return json({ error: 'bad_key', message: 'Kunci bucket tidak sah.' }, 400);
    }

    let assets: AssetItem[] = [];
    if (albumSlug) {
      const album = albumBySlug(albumSlug);
      if (!album) return json({ error: 'not_found', message: 'Album not found.' }, 404);
      const folderKey = /^f:(\d+)$/.exec(key);
      assets = folderKey ? albumAssets(album, Number(folderKey[1])) : (ASSETS_BY_ALBUM.get(album.slug)?.get(key) ?? []);
      if (cam && cam !== 'all') assets = assets.filter((asset) => asset.camera === cam);
    } else {
      if (!isAdmin()) return unauthorised();
      const folder = /^f:(\d+)$/.exec(key);
      assets = folder ? folderAssets(folder[1]) : (adminMonthAssets(key) ?? []);
    }

    const { page, nextCursor } = pageOf(assets, cursorRaw, limitRaw);
    const body: BucketResponse = { assets: page, nextCursor };
    return json(body);
  }),

  http.get(`${API}/o/:id`, () =>
    new HttpResponse('original placeholder', {
      headers: { 'Content-Type': 'image/webp', 'Content-Disposition': 'inline; filename="photo.webp"' }
    })
  ),

  http.get(`${API}/asset/:id`, ({ params }) => {
    const asset = assetById(String(params.id));
    if (!asset) return json({ error: 'not_found', message: 'Photo not found.' }, 404);
    return json({ asset, albumSlug: null });
  }),

  http.post(`${API}/zip`, () => {
    const zip = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ]);
    return new HttpResponse(zip, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="gallery.zip"' }
    });
  }),

  // --- auth ---------------------------------------------------------------
  http.post(`${API}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { username?: string; password?: string };
    if (body.username === 'rafi' && body.password === 'password') {
      if (typeof document !== 'undefined') {
        document.cookie = 'gallery_admin=1; path=/s; SameSite=Lax';
      }
      const response: AdminSessionResponse = { admin: { id: '1', username: 'rafi' } };
      return json(response);
    }
    return json({ error: 'invalid_credentials', message: 'Wrong username or password.' }, 401);
  }),

  http.post(`${API}/auth/logout`, () => {
    if (typeof document !== 'undefined') {
      document.cookie = 'gallery_admin=; path=/s; Max-Age=0; SameSite=Lax';
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API}/auth/session`, () => {
    if (!isAdmin()) return unauthorised();
    const body: AdminSessionResponse = { admin: { id: '1', username: 'rafi' } };
    return json(body);
  }),

  // --- admin --------------------------------------------------------------
  http.get(`${API}/admin/status`, () => (isAdmin() ? json(ADMIN_STATUS) : unauthorised())),

  http.get(`${API}/admin/albums`, () => (isAdmin() ? json({ albums: ADMIN_ALBUMS }) : unauthorised())),

  http.post(`${API}/admin/albums`, async ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as Record<string, unknown>;
    const album = {
      ...ADMIN_ALBUMS[0],
      id: '99',
      title: String(input.title ?? 'New album'),
      slug: String(input.slug ?? 'new-album'),
      folderCount: 0
    };
    return json({ album }, 201);
  }),

  http.patch(`${API}/admin/albums/:id`, async ({ params, request }) => {
    if (!isAdmin()) return unauthorised();
    const base = ADMIN_ALBUMS.find((album) => album.id === String(params.id)) ?? ADMIN_ALBUMS[0];
    const input = (await request.json()) as Record<string, unknown>;
    return json({
      album: {
        ...base,
        title: String(input.title ?? base.title),
        slug: String(input.slug ?? base.slug),
        allowDownload: Boolean(input.allowDownload ?? base.allowDownload),
        folderCount: base.folderCount
      }
    });
  }),

  http.get(`${API}/admin/albums/:id/folders`, ({ params }) => {
    if (!isAdmin()) return unauthorised();
    const ids = ALBUM_FOLDER_IDS[String(params.id)] ?? [];
    return json({
      folders: ids.map((folderId) => ({
        folderId,
        path: folderNode(folderId)?.path ?? '',
        recursive: true,
        included: true
      }))
    });
  }),

  http.put(`${API}/admin/albums/:id/folders`, async ({ params, request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as { rules?: { folderId: string; included: boolean }[] };
    const rules = input.rules ?? [];
    ALBUM_FOLDER_IDS[String(params.id)] = rules.filter((rule) => rule.included).map((rule) => rule.folderId);
    return json({ rules: rules.length, assetCount: 0, folderCount: 0 });
  }),

  http.post(`${API}/admin/scope-preview`, async ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as { rules?: { folderId: string; included: boolean }[] };
    const included = (input.rules ?? []).filter((rule) => rule.included);
    const assetCount = included.reduce((sum, rule) => sum + (folderNode(rule.folderId)?.totalCount ?? 0), 0);
    return json({ assetCount, folderCount: included.length });
  }),

  http.post(`${API}/admin/albums/:id/folders`, async ({ params, request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as { folderId?: string };
    const id = String(params.id);
    const list = ALBUM_FOLDER_IDS[id] ?? [];
    if (input.folderId && !list.includes(input.folderId)) list.push(input.folderId);
    ALBUM_FOLDER_IDS[id] = list;
    return json({ folder: { folderId: input.folderId, path: folderNode(String(input.folderId))?.path ?? '', recursive: true } });
  }),

  http.delete(`${API}/admin/albums/:id/folders/:folderId`, ({ params }) => {
    if (!isAdmin()) return unauthorised();
    const id = String(params.id);
    ALBUM_FOLDER_IDS[id] = (ALBUM_FOLDER_IDS[id] ?? []).filter((folderId) => folderId !== String(params.folderId));
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API}/admin/clients/:id/albums`, ({ params }) => {
    if (!isAdmin()) return unauthorised();
    const client = ADMIN_CLIENTS.find((candidate) => candidate.id === String(params.id));
    if (!client) return json({ error: 'not_found', message: 'Client not found.' }, 404);
    const albums = ADMIN_ALBUMS.filter((album) => album.clientId === client.id).map((album) => ({
      id: album.id,
      title: album.title,
      slug: album.slug,
      allowDownload: album.allowDownload,
      count: album.count,
      rules: (ALBUM_FOLDER_IDS[album.id] ?? []).map((folderId) => ({
        folderId,
        path: folderNode(folderId)?.path ?? '',
        included: true
      }))
    }));
    return json({ client: { id: client.id, name: client.name, slug: client.slug }, albums });
  }),

  http.post(`${API}/admin/clients/:id/albums`, async ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as { folderId?: string };
    const folder = folderNode(String(input.folderId));
    if (!folder) return json({ error: 'bad_folder', message: 'Folder not found.' }, 400);
    return json(
      {
        album: {
          id: '98',
          title: folder.name,
          slug: folder.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          allowDownload: true,
          count: folder.totalCount,
          rules: [{ folderId: folder.id, path: folder.path, included: true }]
        }
      },
      201
    );
  }),

  http.get(`${API}/admin/albums/:id/thumbs`, () =>
    isAdmin() ? json({ total: 1102, ready: 1040, pending: 62, failed: 0 }) : unauthorised()
  ),

  http.post(`${API}/admin/albums/:id/thumbs`, () => (isAdmin() ? json({ queued: 62 }) : unauthorised())),

  http.delete(`${API}/admin/albums/:id`, () => (isAdmin() ? new HttpResponse(null, { status: 204 }) : unauthorised())),

  http.delete(`${API}/admin/clients/:id`, () => (isAdmin() ? new HttpResponse(null, { status: 204 }) : unauthorised())),

  http.get(`${API}/admin/moves`, () =>
    isAdmin()
      ? json({
          moves: [
            {
              from: 'client-1month/20261112 SRIIN Guru & Kelas',
              to: 'CLIENT/2026/20261112 SRIIN Guru & Kelas',
              assets: 842,
              albums: 1,
              movedAt: '2026-12-12T02:10:00.000Z'
            }
          ]
        })
      : unauthorised()
  ),

  http.get(`${API}/admin/clients`, () => (isAdmin() ? json({ clients: ADMIN_CLIENTS }) : unauthorised())),

  http.post(`${API}/admin/clients`, async ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const input = (await request.json()) as { name?: string; slug?: string };
    const name = String(input.name ?? '').trim();
    const slug = String(input.slug ?? '').trim();
    if (!name || !slug) return json({ error: 'bad_request', message: 'Name and link are required.' }, 400);
    return json({ client: { id: '99', name, slug } }, 201);
  }),

  http.get(`${API}/admin/folders`, ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const parentParam = new URL(request.url).searchParams.get('parent');
    if (!parentParam || parentParam === 'root') {
      const body: AdminFolderTreeResponse = { parent: folderNode('1') ?? null, folders: folderChildren('1') };
      return json(body);
    }
    const parent = folderNode(parentParam);
    if (!parent) return json({ error: 'not_found', message: 'Folder not found.' }, 404);
    const body: AdminFolderTreeResponse = { parent, folders: folderChildren(parent.id) };
    return json(body);
  }),

  http.get(`${API}/admin/buckets`, ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const mode = new URL(request.url).searchParams.get('mode') ?? 'date';
    if (mode === 'folder') {
      return json({ buckets: folderChildren('1').map((folder) => ({ key: `f:${folder.id}`, label: folder.path, count: folder.assetCount })) });
    }
    return json({ buckets: ADMIN_BUCKETS });
  }),

  http.get(`${API}/buckets`, ({ request }) => {
    if (!isAdmin()) return unauthorised();
    const mode = new URL(request.url).searchParams.get('mode') ?? 'date';
    if (mode === 'folder') {
      return json({ buckets: folderChildren('1').map((folder) => ({ key: `f:${folder.id}`, label: folder.path, count: folder.assetCount })) });
    }
    return json({ buckets: ADMIN_BUCKETS });
  }),

  http.post(`${API}/admin/rescan`, () => (isAdmin() ? json({ started: true }, 202) : unauthorised())),

  // --- generated placeholder photos --------------------------------------
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
