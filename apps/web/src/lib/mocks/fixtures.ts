import type {
  AdminFolderNode,
  AdminStatusResponse,
  AlbumCard,
  AssetItem,
  BucketSummary,
  ClientSummary
} from '@gallery/shared';

/** Deterministic fixtures; generated gradients only, no client data (AGENTS §2.7). */

const S = '/s';
const LIGHT = ['#c9bfb4', '#8f9aa0', '#b7c4bf', '#d8cfc4', '#6f7b80', '#a99c8f', '#cfd8d6', '#9fb0a8', '#e0d6c8', '#7d8a8f', '#b9aea2', '#c4ccc9'];
const DARK = ['#5d5650', '#4a5257', '#55615c', '#6b625a', '#3d4549', '#625850', '#59625f', '#4c5a54', '#6e665c', '#434c51', '#5f564d', '#535c59'];
const THUMBHASHES = [
  'shgCDwKAh4dzh3h4iHiHiHh3aAeHcI0H',
  '6PcBDwKAh4eDd3h4h3eIiIh3aAeIcI0H',
  'MegBDwKAh4dziHd4eHeIiHd3aAeHgI0H',
  'tRgCDwKAh4dzd3d4d3h3iIeHaAeHcI0H',
  '4OcBDwKAh4eDd4iIh3iIiId3aAeIgI0H',
  '6RgCDwKAh4dzh4eIiHiHh4iHaAeHcI0H',
  'N/gBDwKAh4eDh3h4iHiHiHh3aAeHcH0H',
  'LOgBDwKAh4eDeIiIh3d3iHh3aAeIcH0H',
  '9xgCDwKAh4dzeIiId3eIh4eHaAeIcI0H',
  '5OcBDwKAh4dzh4eIiHiHiId3aAeIcI0H',
  'rRgBDwKAh4dzd4h4iHiIh3iHaAeHcI0H',
  'NPgBDwKAh4eDh4d4h3d4h4iHaAeIcH0H'
];
const RATIOS: [number, number][] = [[800, 1200], [1200, 800], [1000, 1000], [800, 1000], [1000, 800], [900, 1350], [1350, 900]];

function seedOf(text: string): number {
  let seed = 7;
  for (let i = 0; i < text.length; i += 1) seed = (seed * 31 + text.charCodeAt(i)) % 233280;
  return seed;
}

function random(seed: number) {
  let state = seed || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

export function makeAssets(
  prefix: string,
  count: number,
  start = 0,
  theme: 'light' | 'dark' = 'dark',
  cameras: string[] = []
): AssetItem[] {
  const palette = theme === 'light' ? LIGHT : DARK;
  const rand = random(seedOf(prefix) + start);
  const items: AssetItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const [w, h] = RATIOS[Math.floor(rand() * RATIOS.length)];
    const colorIndex = Math.floor(rand() * palette.length);
    const id = `${prefix}-${start + i + 1}`;
    const color = palette[colorIndex].slice(1);
    items.push({
      id,
      w,
      h,
      thumbhash: THUMBHASHES[colorIndex % THUMBHASHES.length],
      thumb: `${S}/mock/img/${color}/${Math.round(w * 0.5)}/${Math.round(h * 0.5)}.svg`,
      preview: `${S}/mock/img/${color}/${Math.round(w * 1.6)}/${Math.round(h * 1.6)}.svg`,
      mime: 'image/webp',
      takenAt: new Date(Date.UTC(2026, 9 + (i % 2), 8 + (i % 20), 8 + Math.floor(i / 18), i % 60)).toISOString(),
      camera: cameras.length ? cameras[(start + i) % cameras.length] : null
    });
  }
  return items;
}

const CLIENT_LIST: ClientSummary[] = [
  { id: '1', name: 'Tadika Mawar', slug: 'tadika-mawar' },
  { id: '2', name: 'Aina & Hafiz', slug: 'aina-hafiz' }
];

interface AlbumSeed {
  id: string;
  title: string;
  slug: string;
  client: ClientSummary;
  count: number;
  folderCount: number;
  cameras: string[];
  allowDownload: boolean;
  takenAt: string;
  bucketKeys: string[];
}

const ALBUM_SEEDS: AlbumSeed[] = [
  { id: '1', title: 'Konvo 2026', slug: 'mawar-konvo-2026', client: CLIENT_LIST[0], count: 1102, folderCount: 1, cameras: ['Cam 1', 'Cam 2'], allowDownload: true, takenAt: '2026-11-22T09:00:00.000Z', bucketKeys: ['2026-11', '2026-10'] },
  { id: '2', title: 'Hari Sukan 2026', slug: 'mawar-sukan-2026', client: CLIENT_LIST[0], count: 980, folderCount: 1, cameras: [], allowDownload: true, takenAt: '2026-09-14T08:00:00.000Z', bucketKeys: ['2026-09'] },
  { id: '3', title: 'Sambutan Raya 2026', slug: 'mawar-raya-2026', client: CLIENT_LIST[0], count: 620, folderCount: 1, cameras: [], allowDownload: false, takenAt: '2026-04-18T09:00:00.000Z', bucketKeys: ['2026-04'] },
  { id: '4', title: 'Hari Guru 2026', slug: 'mawar-hari-guru-2026', client: CLIENT_LIST[0], count: 710, folderCount: 1, cameras: ['Cam 1', 'Cam 2'], allowDownload: true, takenAt: '2026-05-16T08:00:00.000Z', bucketKeys: ['2026-05'] },
  { id: '5', title: 'Akad nikah', slug: 'aina-hafiz-akad', client: CLIENT_LIST[1], count: 520, folderCount: 2, cameras: ['Cam 1', 'Cam 2'], allowDownload: true, takenAt: '2026-10-04T09:00:00.000Z', bucketKeys: ['2026-10'] },
  { id: '6', title: 'Sanding', slug: 'aina-hafiz-sanding', client: CLIENT_LIST[1], count: 862, folderCount: 3, cameras: ['Cam 1', 'Cam 2'], allowDownload: true, takenAt: '2026-11-08T09:00:00.000Z', bucketKeys: ['2026-11'] }
];

export const ASSETS_BY_ALBUM = new Map<string, Map<string, AssetItem[]>>();
export const BUCKETS_BY_ALBUM = new Map<string, BucketSummary[]>();
const assetIndex = new Map<string, AssetItem>();

for (const seed of ALBUM_SEEDS) {
  const pages = new Map<string, AssetItem[]>();
  const buckets: BucketSummary[] = seed.bucketKeys.map((key, index) => ({
    key,
    count: index === 0 ? Math.ceil(seed.count * 0.58) : seed.count - Math.ceil(seed.count * 0.58)
  }));
  const baseDate = new Date(seed.takenAt);
  buckets.forEach((bucket, bucketIndex) => {
    const items = makeAssets(`${seed.slug}--${bucket.key}`, 60, 0, 'dark', seed.cameras);
    items.forEach((item, index) => {
      item.takenAt = new Date(
        Date.UTC(
          baseDate.getUTCFullYear(),
          baseDate.getUTCMonth() - bucketIndex,
          baseDate.getUTCDate(),
          9 + Math.floor(index / 18),
          index % 60
        )
      ).toISOString();
    });
    pages.set(bucket.key, items);
    for (const item of items) assetIndex.set(item.id, item);
  });
  ASSETS_BY_ALBUM.set(seed.slug, pages);
  BUCKETS_BY_ALBUM.set(seed.slug, buckets);
}

function coversFor(slug: string, n = 4): AssetItem[] {
  const pages = ASSETS_BY_ALBUM.get(slug);
  if (!pages) return [];
  const out: AssetItem[] = [];
  for (const items of pages.values()) {
    for (const item of items) {
      if (out.length >= n) return out;
      out.push(item);
    }
  }
  return out;
}

export interface MockAlbumCard extends AlbumCard {
  covers: AssetItem[];
  cameras: string[];
  folderCount: number;
  takenAt: string | null;
  clientName: string;
  clientSlug: string;
}

export const ALBUMS: MockAlbumCard[] = ALBUM_SEEDS.map((seed) => {
  const covers = coversFor(seed.slug);
  return {
    id: seed.id,
    clientId: seed.client.id,
    title: seed.title,
    slug: seed.slug,
    allowDownload: seed.allowDownload,
    count: seed.count,
    cover: covers[0] ?? null,
    covers,
    cameras: seed.cameras,
    folderCount: seed.folderCount,
    takenAt: seed.takenAt,
    clientName: seed.client.name,
    clientSlug: seed.client.slug
  };
});

export function albumBySlug(slug: string): MockAlbumCard | undefined {
  return ALBUMS.find((album) => album.slug === slug);
}

export function albumById(id: string): MockAlbumCard | undefined {
  return ALBUMS.find((album) => album.id === id);
}

export function clientBySlug(slug: string): ClientSummary | undefined {
  return CLIENT_LIST.find((client) => client.slug === slug);
}

export function assetById(id: string): AssetItem | undefined {
  return assetIndex.get(id);
}

export function cameraTotal(album: MockAlbumCard, camera: string): number {
  const index = album.cameras.indexOf(camera);
  if (index < 0) return 0;
  const first = Math.ceil(album.count * 0.58);
  return index === 0 ? first : album.count - first;
}

export const ADMIN_ALBUMS = ALBUMS.map((album) => ({
  id: album.id,
  clientId: album.clientId,
  title: album.title,
  slug: album.slug,
  allowDownload: album.allowDownload,
  clientSlug: album.clientSlug,
  clientName: album.clientName,
  folderCount: album.folderCount
}));

export const ADMIN_CLIENTS = CLIENT_LIST.map((client) => ({
  ...client,
  albumCount: ALBUMS.filter((album) => album.clientId === client.id).length
}));

// Admin timeline: month buckets from the real API.
export const ADMIN_BUCKETS: BucketSummary[] = [
  { key: '2026-11', count: 1284 },
  { key: '2026-10', count: 864 },
  { key: '2026-09', count: 212 }
];

const ADMIN_MONTH_ASSETS = new Map<string, AssetItem[]>();
for (const bucket of ADMIN_BUCKETS) {
  const [year, month] = bucket.key.split('-').map(Number);
  const items = makeAssets(`admin-${bucket.key}`, 42, 0, 'light');
  items.forEach((item, index) => {
    item.takenAt = new Date(Date.UTC(year, month - 1, 28 - (index % 24), 9, index % 60)).toISOString();
  });
  for (const item of items) assetIndex.set(item.id, item);
  ADMIN_MONTH_ASSETS.set(bucket.key, items);
}

export function adminMonthAssets(key: string): AssetItem[] | undefined {
  return ADMIN_MONTH_ASSETS.get(key);
}

// Folder tree (ids are strings in the API).
const ROOT: AdminFolderNode = {
  id: '1',
  path: '.',
  name: '/',
  parentId: null,
  assetCount: 0,
  hasChildren: true
};

const FOLDER_NODES: AdminFolderNode[] = [
  { id: '2', path: 'BTS', name: 'BTS', parentId: '1', assetCount: 0, hasChildren: true },
  { id: '12', path: 'BTS/Aina Hafiz BTS', name: 'Aina Hafiz BTS', parentId: '2', assetCount: 158, hasChildren: false },
  { id: '3', path: 'CLIENT', name: 'CLIENT', parentId: '1', assetCount: 0, hasChildren: true },
  { id: '8', path: 'CLIENT/Konvo Tadika Mawar 2026', name: 'Konvo Tadika Mawar 2026', parentId: '3', assetCount: 1284, hasChildren: true },
  { id: '9', path: 'CLIENT/Kahwin Aina & Hafiz', name: 'Kahwin Aina & Hafiz', parentId: '3', assetCount: 864, hasChildren: false },
  { id: '10', path: 'CLIENT/Konvo Tadika Seri Kasih', name: 'Konvo Tadika Seri Kasih', parentId: '3', assetCount: 742, hasChildren: false },
  { id: '11', path: 'CLIENT/Annual Dinner Syarikat ABC', name: 'Annual Dinner Syarikat ABC', parentId: '3', assetCount: 290, hasChildren: false },
  { id: '4', path: 'PORTFOLIO', name: 'PORTFOLIO', parentId: '1', assetCount: 0, hasChildren: true },
  { id: '14', path: 'PORTFOLIO/Fesyen 2026', name: 'Fesyen 2026', parentId: '4', assetCount: 506, hasChildren: false },
  { id: '5', path: 'PRINT', name: 'PRINT', parentId: '1', assetCount: 0, hasChildren: true },
  { id: '13', path: 'PRINT/Aina Hafiz cetak', name: 'Aina Hafiz cetak', parentId: '5', assetCount: 80, hasChildren: false },
  { id: '6', path: 'Raya', name: 'Raya', parentId: '1', assetCount: 0, hasChildren: false },
  { id: '7', path: 'RAYA2026_frame', name: 'RAYA2026_frame', parentId: '1', assetCount: 0, hasChildren: false }
];

const FOLDER_ASSETS = new Map<string, AssetItem[]>();
for (const node of FOLDER_NODES) {
  if (node.assetCount === 0 && !['8', '9', '10', '11', '13', '14'].includes(node.id)) continue;
  const items = makeAssets(`folder-${node.id}`, 24, 0, 'light');
  items.forEach((item, index) => {
    item.takenAt = new Date(Date.UTC(2026, 10, 24 - (index % 20), 9, index % 60)).toISOString();
  });
  for (const item of items) assetIndex.set(item.id, item);
  FOLDER_ASSETS.set(node.id, items);
}

export function folderChildren(parentId: string): AdminFolderNode[] {
  return FOLDER_NODES.filter((node) => node.parentId === parentId);
}

export function folderNode(id: string): AdminFolderNode | undefined {
  if (id === '1') return ROOT;
  return FOLDER_NODES.find((node) => node.id === id);
}

export function folderAssets(id: string): AssetItem[] {
  return FOLDER_ASSETS.get(id) ?? [];
}

export const ADMIN_STATUS: AdminStatusResponse & {
  hotCache: { usedBytes: number; capBytes: number };
  ram: { freeBytes: number; totalBytes: number };
  faceSearch: boolean;
  updatedAt: string;
  log: { at: string; message: string }[];
} = {
  assets: 128402,
  pendingThumbs: 312,
  pendingR2: 312,
  r2Enabled: true,
  lastScanAt: '2026-11-24T22:31:00.000Z',
  errors24h: 0,
  hotCache: { usedBytes: 42 * 1024 ** 3, capBytes: 80 * 1024 ** 3 },
  ram: { freeBytes: 3.1 * 1024 ** 3, totalBytes: 11 * 1024 ** 3 },
  faceSearch: false,
  updatedAt: '2026-11-24T22:48:00.000Z',
  log: [
    { at: '22:47', message: '64 gambar baru dikesan dalam CLIENT / Kahwin Aina & Hafiz' },
    { at: '22:31', message: 'Imbas semula selesai · 0 ralat' },
    { at: '21:05', message: 'Link /s/aina-hafiz dicipta' },
    { at: '03:00', message: 'Hot cache: 812 fail dibuang (cukup 30 hari) · 9.6 GB dibebaskan' }
  ]
};

/** Album folders selected in the edit screen. */
export const ALBUM_FOLDER_IDS: Record<string, string[]> = {
  '1': ['8'],
  '6': ['9', '12', '13']
};

export const ALL_CLIENTS = CLIENT_LIST;
