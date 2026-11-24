import path from 'node:path';
import type { Pool } from 'pg';
import type { AlbumFolderCard, AlbumFolderResponse } from '@gallery/shared';
import { toAssetItem, type AssetRow } from './rows.js';

/**
 * Folder navigation inside a public album. The album scope is a set of folders;
 * each in-scope folder hangs under its nearest in-scope ancestor, so excluded
 * folders simply disappear from the tree. Folders whose subtree holds no photos
 * are hidden. When the album has exactly one top folder it is the album top.
 */

interface ScopeFolderRow {
  id: string;
  path: string;
  count: number;
}

interface Node {
  id: string;
  path: string;
  name: string;
  own: number;
  total: number;
  parent: Node | null;
  children: Node[];
  cover: AssetRow | null;
}

const collator = new Intl.Collator('ms', { numeric: true, sensitivity: 'base' });

function newer(a: AssetRow | null, b: AssetRow | null): AssetRow | null {
  if (!a) return b;
  if (!b) return a;
  const at = a.taken_at ? new Date(a.taken_at).getTime() : -Infinity;
  const bt = b.taken_at ? new Date(b.taken_at).getTime() : -Infinity;
  if (at !== bt) return at > bt ? a : b;
  return BigInt(a.id) > BigInt(b.id) ? a : b;
}

function ancestors(folderPath: string): string[] {
  if (folderPath === '.') return [];
  const parts = folderPath.split('/');
  const out: string[] = [];
  for (let index = parts.length - 1; index > 0; index -= 1) out.push(parts.slice(0, index).join('/'));
  out.push('.');
  return out;
}

export type AlbumFolderResult = AlbumFolderResponse | 'not_found';

export async function albumFolderView(options: {
  pool: Pool;
  albumId: string;
  albumSlug: string;
  thumbBase: string;
  folderId: string | null;
}): Promise<AlbumFolderResult> {
  const { pool } = options;
  const { rows } = await pool.query<ScopeFolderRow>(
    `SELECT f.id::text AS id, f.path,
            (SELECT count(*) FROM asset a WHERE a.folder_id = f.id AND a.deleted_at IS NULL)::int AS count
     FROM album_scope($1) s JOIN folder f ON f.id = s.fid`,
    [options.albumId],
  );

  const byPath = new Map<string, Node>();
  for (const row of rows) {
    byPath.set(row.path, {
      id: row.id,
      path: row.path,
      name: row.path === '.' ? 'Semua' : path.posix.basename(row.path),
      own: row.count,
      total: row.count,
      parent: null,
      children: [],
      cover: null,
    });
  }

  const withPhotos = rows.filter((row) => row.count > 0).map((row) => row.id);
  if (withPhotos.length > 0) {
    const covers = await pool.query<AssetRow & { folder_id: string }>(
      `SELECT DISTINCT ON (folder_id) folder_id::text AS folder_id, id, deriv_key, w, h, taken_at, camera, thumbhash, mime
       FROM asset
       WHERE folder_id = ANY($1::bigint[]) AND deleted_at IS NULL
       ORDER BY folder_id, taken_at DESC NULLS LAST, id DESC`,
      [withPhotos],
    );
    const byId = new Map([...byPath.values()].map((node) => [node.id, node]));
    for (const cover of covers.rows) {
      const node = byId.get(cover.folder_id);
      if (node) node.cover = cover;
    }
  }

  // Link each folder to its nearest in-scope ancestor.
  const nodes = [...byPath.values()];
  for (const node of nodes) {
    for (const candidate of ancestors(node.path)) {
      const parent = byPath.get(candidate);
      if (parent) {
        node.parent = parent;
        parent.children.push(node);
        break;
      }
    }
  }

  // Roll totals and covers up, deepest first.
  const depth = (node: Node) => (node.path === '.' ? 0 : node.path.split('/').length);
  for (const node of [...nodes].sort((a, b) => depth(b) - depth(a))) {
    if (!node.parent) continue;
    node.parent.total += node.total;
    node.parent.cover = newer(node.parent.cover, node.cover);
  }

  const visible = (node: Node) => node.total > 0;
  const sortCards = (list: Node[]) =>
    list.filter(visible).sort((a, b) => collator.compare(a.name, b.name));
  const roots = sortCards(nodes.filter((node) => !node.parent));
  const autoRoot = roots.length === 1 ? roots[0] ?? null : null;

  let current: Node | null;
  if (options.folderId) {
    current = nodes.find((node) => node.id === options.folderId && visible(node)) ?? null;
    if (!current) return 'not_found';
  } else {
    current = autoRoot;
  }

  const trail: { id: string; name: string }[] = [];
  for (let step = current; step && step !== autoRoot; step = step.parent) {
    trail.unshift({ id: step.id, name: step.name });
  }

  const card = (node: Node): AlbumFolderCard => ({
    id: node.id,
    name: node.name,
    count: node.total,
    cover: node.cover ? toAssetItem(node.cover, options.thumbBase, options.albumSlug) : null,
  });

  return {
    folderId: current?.id ?? null,
    trail,
    folders: (current ? sortCards(current.children) : roots).map(card),
    assetCount: current?.own ?? 0,
  };
}
