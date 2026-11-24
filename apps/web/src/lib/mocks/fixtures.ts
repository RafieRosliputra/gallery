import type {
  AdminAlbum,
  AdminClient,
  AdminFolderCard,
  AdminFolderNode,
  AdminFolderView,
  AdminStatusView,
  AdminTreeEntry,
  AlbumCard,
  AssetItem,
  BucketRef,
  ClientRef
} from '@gallery/shared';

/** Fixtures are deterministic and contain no client data (AGENTS §2.7). */

const S = '/s';

const LIGHT = [
  '#c9bfb4',
  '#8f9aa0',
  '#b7c4bf',
  '#d8cfc4',
  '#6f7b80',
  '#a99c8f',
  '#cfd8d6',
  '#9fb0a8',
  '#e0d6c8',
  '#7d8a8f',
  '#b9aea2',
  '#c4ccc9'
];

const DARK = [
  '#5d5650',
  '#4a5257',
  '#55615c',
  '#6b625a',
  '#3d4549',
  '#625850',
  '#59625f',
  '#4c5a54',
  '#6e665c',
  '#434c51',
  '#5f564d',
  '#535c59'
];

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

const RATIOS: [number, number][] = [
  [800, 1200],
  [1200, 800],
  [1000, 1000],
  [800, 1000],
  [1000, 800],
  [900, 1350],
  [1350, 900]
];

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
    const camera = cameras.length ? cameras[(start + i) % cameras.length] : null;
    items.push({
      id,
      w,
      h,
      thumbhash: THUMBHASHES[colorIndex % THUMBHASHES.length],
      thumbUrl: `${S}/mock/img/${color}/${w}/${h}.svg`,
      previewUrl: `${S}/mock/img/${color}/${Math.round(w * 1.6)}/${Math.round(h * 1.6)}.svg`,
      mime: 'image/webp',
      takenAt: new Date(Date.UTC(2026, 10, 22, 8 + Math.floor(i / 18), i % 60)).toISOString(),
      camera
    });
  }
  return items;
}

const CLIENT_LIST: ClientRef[] = [
  { id: 'cl-tadika', name: 'Tadika Mawar', slug: 'tadika-mawar' },
  { id: 'cl-aina', name: 'Aina & Hafiz', slug: 'aina-hafiz' }
];

interface AlbumSeed {
  id: string;
  title: string;
  slug: string;
  client: ClientRef;
  count: number;
  folders: number;
  cameras: string[];
  allowDownload: boolean;
  takenAt: string;
}

const ALBUM_SEEDS: AlbumSeed[] = [
  {
    id: 'mawar-konvo-2026',
    title: 'Konvo 2026',
    slug: 'mawar-konvo-2026',
    client: CLIENT_LIST[0],
    count: 1102,
    folders: 1,
    cameras: ['Cam 1', 'Cam 2'],
    allowDownload: true,
    takenAt: '2026-11-22T09:00:00.000Z'
  },
  {
    id: 'mawar-sukan-2026',
    title: 'Hari Sukan 2026',
    slug: 'mawar-sukan-2026',
    client: CLIENT_LIST[0],
    count: 980,
    folders: 1,
    cameras: [],
    allowDownload: true,
    takenAt: '2026-09-14T08:00:00.000Z'
  },
  {
    id: 'mawar-raya-2026',
    title: 'Sambutan Raya 2026',
    slug: 'mawar-raya-2026',
    client: CLIENT_LIST[0],
    count: 620,
    folders: 1,
    cameras: [],
    allowDownload: false,
    takenAt: '2026-04-18T09:00:00.000Z'
  },
  {
    id: 'mawar-hari-guru-2026',
    title: 'Hari Guru 2026',
    slug: 'mawar-hari-guru-2026',
    client: CLIENT_LIST[0],
    count: 710,
    folders: 1,
    cameras: ['Cam 1', 'Cam 2'],
    allowDownload: true,
    takenAt: '2026-05-16T08:00:00.000Z'
  },
  {
    id: 'aina-hafiz-akad',
    title: 'Akad nikah',
    slug: 'aina-hafiz-akad',
    client: CLIENT_LIST[1],
    count: 520,
    folders: 2,
    cameras: ['Cam 1', 'Cam 2'],
    allowDownload: true,
    takenAt: '2026-10-04T09:00:00.000Z'
  },
  {
    id: 'aina-hafiz-sanding',
    title: 'Sanding',
    slug: 'aina-hafiz-sanding',
    client: CLIENT_LIST[1],
    count: 862,
    folders: 3,
    cameras: ['Cam 1', 'Cam 2'],
    allowDownload: true,
    takenAt: '2026-11-08T09:00:00.000Z'
  }
];

export const BUCKETS_BY_ALBUM = new Map<string, BucketRef[]>();
export const ASSETS_BY_ALBUM = new Map<string, Map<string, AssetItem[]>>();
const assetIndex = new Map<string, AssetItem>();

for (const seed of ALBUM_SEEDS) {
  const morning = Math.round(seed.count * 0.58);
  const buckets: BucketRef[] =
    seed.cameras.length > 0
      ? [
          { key: 'pagi', label: '9:00 pagi', count: morning },
          { key: 'tengah-hari', label: '11:00 pagi', count: seed.count - morning }
        ]
      : [{ key: 'hari', label: '22 Nov 2026', count: seed.count }];
  const pages = new Map<string, AssetItem[]>();
  for (const bucket of buckets) {
    const items = makeAssets(
      `${seed.slug}--${bucket.key}`,
      84,
      0,
      'dark',
      seed.cameras.length ? seed.cameras : []
    );
    pages.set(bucket.key, items);
    for (const item of items) assetIndex.set(item.id, item);
  }
  BUCKETS_BY_ALBUM.set(seed.slug, buckets);
  ASSETS_BY_ALBUM.set(seed.slug, pages);
}

function coversFor(slug: string, n = 3): AssetItem[] {
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

export const ALBUMS: AlbumCard[] = ALBUM_SEEDS.map((seed) => {
  const covers = coversFor(seed.slug, 4);
  return {
    id: seed.id,
    title: seed.title,
    slug: seed.slug,
    clientId: seed.client.id,
    clientName: seed.client.name,
    clientSlug: seed.client.slug,
    allowDownload: seed.allowDownload,
    assetCount: seed.count,
    folderCount: seed.folders,
    coverAssetIds: covers.map((c) => c.id),
    covers,
    cameras: seed.cameras,
    takenAt: seed.takenAt
  };
});

export function albumBySlug(slug: string): AlbumCard | undefined {
  return ALBUMS.find((album) => album.slug === slug);
}

export function albumById(id: string): AlbumCard | undefined {
  return ALBUMS.find((album) => album.id === id);
}

export function clientBySlug(slug: string): ClientRef | undefined {
  return CLIENT_LIST.find((client) => client.slug === slug);
}

export function assetById(id: string): AssetItem | undefined {
  return assetIndex.get(id);
}

export const ADMIN_ALBUMS: AdminAlbum[] = ALBUMS.map((album) => ({
  ...album,
  createdAt: '2026-11-01T00:00:00.000Z'
}));

export const ADMIN_CLIENTS: AdminClient[] = CLIENT_LIST.map((client) => {
  const albums = ADMIN_ALBUMS.filter((album) => album.clientId === client.id);
  return {
    ...client,
    albumCount: albums.length,
    assetCount: albums.reduce((sum, album) => sum + album.assetCount, 0),
    albums
  };
});

const DAY_ASSETS = new Map<string, AssetItem[]>();
for (const key of ['2026-11-24', '2026-11-22', '2026-11-19']) {
  const items = makeAssets(`admin-day-${key}`, 42, 0, 'light');
  for (const item of items) assetIndex.set(item.id, item);
  DAY_ASSETS.set(key, items);
}

export const ADMIN_BUCKETS: BucketRef[] = [
  {
    key: '2026-11-24',
    label: 'Isnin, 24 Nov 2026',
    sub: 'CLIENT / Konvo Tadika Mawar · 1,284 gambar',
    count: 1284,
    year: 2026,
    month: 11,
    monthLabel: 'Nov'
  },
  {
    key: '2026-11-22',
    label: 'Sabtu, 22 Nov 2026',
    sub: 'CLIENT / Kahwin Aina & Hafiz · 864 gambar',
    count: 864,
    year: 2026,
    month: 11,
    monthLabel: 'Nov'
  },
  {
    key: '2026-11-19',
    label: 'Rabu, 19 Nov 2026',
    sub: 'PORTFOLIO / Studio fesyen · 212 gambar',
    count: 212,
    year: 2026,
    month: 11,
    monthLabel: 'Nov'
  }
];

export const ADMIN_MONTHS = [
  {
    year: 2026,
    months: [
      { key: '2026-11', label: 'Nov' },
      { key: '2026-10', label: 'Okt' },
      { key: '2026-09', label: 'Sep' },
      { key: '2026-08', label: 'Ogo' },
      { key: '2026-07', label: 'Jul' }
    ]
  },
  {
    year: 2025,
    months: [
      { key: '2025-12', label: 'Dis' },
      { key: '2025-11', label: 'Nov' }
    ]
  }
];

export function dayAssets(key: string): AssetItem[] | undefined {
  return DAY_ASSETS.get(key);
}

const TREE: AdminTreeEntry[] = [
  { id: 'f-bts', name: 'BTS', path: 'BTS', depth: 0, assetCount: 0, folderCount: 1 },
  { id: 'f-bts-aina', name: 'Aina Hafiz BTS', path: 'BTS/Aina Hafiz BTS', depth: 1, assetCount: 158, folderCount: 0 },
  { id: 'f-client', name: 'CLIENT', path: 'CLIENT', depth: 0, assetCount: 4, folderCount: 4 },
  { id: 'f-konvo', name: 'Konvo Tadika Mawar 2026', path: 'CLIENT/Konvo Tadika Mawar 2026', depth: 1, assetCount: 1102, folderCount: 2 },
  { id: 'f-kahwin', name: 'Kahwin Aina & Hafiz', path: 'CLIENT/Kahwin Aina & Hafiz', depth: 1, assetCount: 864, folderCount: 0 },
  { id: 'f-seri', name: 'Konvo Tadika Seri Kasih', path: 'CLIENT/Konvo Tadika Seri Kasih', depth: 1, assetCount: 742, folderCount: 0 },
  { id: 'f-dinner', name: 'Annual Dinner Syarikat ABC', path: 'CLIENT/Annual Dinner Syarikat ABC', depth: 1, assetCount: 290, folderCount: 0 },
  { id: 'f-portfolio', name: 'PORTFOLIO', path: 'PORTFOLIO', depth: 0, assetCount: 4, folderCount: 1 },
  { id: 'f-print', name: 'PRINT', path: 'PRINT', depth: 0, assetCount: 1, folderCount: 1 },
  { id: 'f-aina-print', name: 'Aina Hafiz cetak', path: 'PRINT/Aina Hafiz cetak', depth: 1, assetCount: 80, folderCount: 0 },
  { id: 'f-raya', name: 'Raya', path: 'Raya', depth: 0, assetCount: 0, folderCount: 0 },
  { id: 'f-raya-frame', name: 'RAYA2026_frame', path: 'RAYA2026_frame', depth: 0, assetCount: 0, folderCount: 0 }
];

export const FOLDER_TREE = TREE;

const FOLDER_CARDS: AdminFolderCard[] = [
  { id: 'f-konvo', name: 'Konvo Tadika Mawar 2026', path: 'CLIENT/Konvo Tadika Mawar 2026', assetCount: 1284, folderCount: 2, coverAssetIds: [], covers: coversFor('mawar-konvo-2026', 4), lastTakenAt: '2026-11-24T09:00:00.000Z' },
  { id: 'f-kahwin', name: 'Kahwin Aina & Hafiz', path: 'CLIENT/Kahwin Aina & Hafiz', assetCount: 864, folderCount: 0, coverAssetIds: [], covers: coversFor('aina-hafiz-sanding', 4), lastTakenAt: '2026-11-22T09:00:00.000Z' },
  { id: 'f-seri', name: 'Konvo Tadika Seri Kasih', path: 'CLIENT/Konvo Tadika Seri Kasih', assetCount: 742, folderCount: 0, coverAssetIds: [], covers: coversFor('mawar-hari-guru-2026', 4), lastTakenAt: '2026-11-15T09:00:00.000Z' },
  { id: 'f-dinner', name: 'Annual Dinner Syarikat ABC', path: 'CLIENT/Annual Dinner Syarikat ABC', assetCount: 290, folderCount: 0, coverAssetIds: [], covers: coversFor('mawar-raya-2026', 4), lastTakenAt: '2026-11-08T09:00:00.000Z' }
];

export function folderView(path: string): AdminFolderView {
  const clean = path.replace(/^\/+|\/+$/g, '') || 'CLIENT';
  const parts = clean.split('/').filter(Boolean);
  const breadcrumb = parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
  const tree =
    clean === 'CLIENT'
      ? TREE.filter((node) => node.path === 'CLIENT' || node.path.startsWith('CLIENT/') || node.depth === 0)
      : TREE;
  return {
    path: clean,
    breadcrumb,
    tree,
    folders: clean === 'CLIENT' ? FOLDER_CARDS : FOLDER_CARDS.slice(0, 1),
    folderCount: 4,
    assetCount: 3180,
    loose: makeAssets('admin-folder-loose', 9, 0, 'light')
  };
}

export function albumDetail(id: string) {
  const album = albumById(id);
  if (!album) return null;
  const folders: AdminFolderNode[] = TREE.map((node) => ({
    ...node,
    selected:
      (album.slug === 'mawar-konvo-2026' && node.path === 'CLIENT/Konvo Tadika Mawar 2026') ||
      (album.slug === 'aina-hafiz-sanding' && node.path === 'CLIENT/Kahwin Aina & Hafiz') ||
      (album.slug === 'aina-hafiz-sanding' && node.path === 'BTS/Aina Hafiz BTS') ||
      (album.slug === 'aina-hafiz-sanding' && node.path === 'PRINT/Aina Hafiz cetak')
  }));
  return {
    album: { ...album, createdAt: '2026-11-01T00:00:00.000Z' },
    folders,
    previews: coversFor(album.slug, 4),
    totalAssets: album.assetCount,
    clients: CLIENT_LIST
  };
}

export const ADMIN_STATUS: AdminStatusView = {
  assets: 128402,
  pendingThumbs: 312,
  pendingR2: 312,
  lastScanAt: '2026-11-24T22:31:00.000Z',
  errors24h: 0,
  thumbsDone: 128090,
  r2Done: 128090,
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

export const ALL_CLIENTS = CLIENT_LIST;
