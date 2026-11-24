import path from 'node:path';
import type { Pool } from 'pg';

/**
 * Move detection, run at the end of a scan pass.
 *
 * A "missing" asset (its path was not seen this pass, or it was soft-deleted in
 * the last 30 days) and a newer live asset with the same file name, size and
 * mtime (within 2 s) are the same photo that moved. The old row survives — its id keeps
 * client favourites and share links working and its thumbnails stay valid —
 * and takes the new path; the newer duplicate row is dropped.
 *
 * Folders are then inferred from the moved files: if every moved file that
 * lived under an old folder now lives under one new folder (same relative
 * layout) and nothing is left behind, the folder moved. Album rules on the old
 * folder follow it, and the move is logged in `folder_move`.
 */

export interface MergedAsset {
  oldId: string;
  newId: string;
  oldPath: string;
  newPath: string;
  /** Derivative key of the dropped duplicate row (its thumbnails can go). */
  droppedKey: string;
}

export interface FolderMove {
  from: string;
  to: string;
  assets: number;
  albums: number;
}

interface CandidateRow {
  old_id: string;
  old_path: string;
  new_id: string;
  new_path: string;
  new_key: string;
}

export async function mergeMovedAssets(pool: Pool, missingIds: string[]): Promise<MergedAsset[]> {
  if (missingIds.length === 0) return [];
  const { rows } = await pool.query<CandidateRow>(
    `SELECT m.id::text AS old_id, m.path AS old_path, c.id::text AS new_id, c.path AS new_path, c.deriv_key AS new_key
     FROM asset m
     JOIN asset c
       ON c.size = m.size AND c.id > m.id AND c.deleted_at IS NULL
      -- Copies across filesystems/SMB can round mtime; allow under 2 s.
      AND abs(extract(epoch FROM c.mtime - m.mtime)) < 2
      AND lower(regexp_replace(c.path, '^.*/', '')) = lower(regexp_replace(m.path, '^.*/', ''))
     WHERE m.id = ANY($1::bigint[])
       AND c.id <> ALL($1::bigint[])
       AND (m.deleted_at IS NULL OR m.deleted_at > now() - interval '30 days')
     ORDER BY m.id, c.id`,
    [missingIds],
  );

  // One-to-one, oldest rows first.
  const usedOld = new Set<string>();
  const usedNew = new Set<string>();
  const pairs: MergedAsset[] = [];
  for (const row of rows) {
    if (usedOld.has(row.old_id) || usedNew.has(row.new_id)) continue;
    usedOld.add(row.old_id);
    usedNew.add(row.new_id);
    pairs.push({ oldId: row.old_id, newId: row.new_id, oldPath: row.old_path, newPath: row.new_path, droppedKey: row.new_key });
  }
  if (pairs.length === 0) return [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gone = await client.query<{ old_id: string; path: string; folder_id: string; camera: string | null }>(
      `DELETE FROM asset a
       USING unnest($1::bigint[], $2::bigint[]) AS p(old_id, new_id)
       WHERE a.id = p.new_id
       RETURNING p.old_id::text AS old_id, a.path, a.folder_id::text AS folder_id, a.camera`,
      [pairs.map((pair) => pair.oldId), pairs.map((pair) => pair.newId)],
    );
    await client.query(
      `UPDATE asset o
       SET path = g.path, folder_id = g.folder_id, camera = g.camera, deleted_at = NULL, scanned_at = now()
       FROM unnest($1::bigint[], $2::text[], $3::bigint[], $4::text[]) AS g(old_id, path, folder_id, camera)
       WHERE o.id = g.old_id`,
      [
        gone.rows.map((row) => row.old_id),
        gone.rows.map((row) => row.path),
        gone.rows.map((row) => row.folder_id),
        gone.rows.map((row) => row.camera),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return pairs;
}

function segments(directory: string): string[] {
  return directory === '.' || directory === '' ? [] : directory.split('/');
}

function joined(parts: string[]): string {
  return parts.length === 0 ? '.' : parts.join('/');
}

/** Candidate (old folder → new folder) pairs implied by one moved file. */
export function folderPairs(oldPath: string, newPath: string): [string, string][] {
  const oldDir = segments(path.posix.dirname(oldPath));
  const newDir = segments(path.posix.dirname(newPath));
  let common = 0;
  while (
    common < oldDir.length &&
    common < newDir.length &&
    oldDir[oldDir.length - 1 - common] === newDir[newDir.length - 1 - common]
  ) {
    common += 1;
  }
  const pairs: [string, string][] = [];
  for (let level = 0; level <= common; level += 1) {
    const from = joined(oldDir.slice(0, oldDir.length - level));
    const to = joined(newDir.slice(0, newDir.length - level));
    if (from === to || from === '.') break;
    pairs.push([from, to]);
  }
  return pairs;
}

export async function recordFolderMoves(pool: Pool, merged: MergedAsset[]): Promise<FolderMove[]> {
  if (merged.length === 0) return [];
  const targets = new Map<string, Map<string, number>>();
  for (const move of merged) {
    for (const [from, to] of folderPairs(move.oldPath, move.newPath)) {
      const byTarget = targets.get(from) ?? new Map<string, number>();
      byTarget.set(to, (byTarget.get(to) ?? 0) + 1);
      targets.set(from, byTarget);
    }
  }

  // Consistent: every moved file under the old folder agrees on one new folder.
  const consistent = new Map<string, { to: string; assets: number }>();
  for (const [from, byTarget] of targets) {
    if (byTarget.size !== 1) continue;
    const [[to, assets]] = [...byTarget.entries()] as [[string, number]];
    consistent.set(from, { to, assets });
  }
  if (consistent.size === 0) return [];

  // Complete: nothing live is left under the old folder.
  const { rows: leftovers } = await pool.query<{ path: string }>(
    `SELECT p.path FROM unnest($1::text[]) AS p(path)
     WHERE EXISTS (
       SELECT 1 FROM asset a
       WHERE a.deleted_at IS NULL AND (a.path LIKE replace(replace(replace(p.path, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '/%')
     )`,
    [[...consistent.keys()]],
  );
  for (const row of leftovers) consistent.delete(row.path);
  if (consistent.size === 0) return [];

  const moves: FolderMove[] = [];
  for (const [from, { to, assets }] of consistent) {
    // Point album rules at the new folder (unless the album already has one there).
    const remapped = await pool.query(
      `WITH o AS (SELECT id FROM folder WHERE path = $1), n AS (SELECT id FROM folder WHERE path = $2)
       UPDATE album_folder af SET folder_id = (SELECT id FROM n)
       WHERE af.folder_id = (SELECT id FROM o) AND EXISTS (SELECT 1 FROM n)
         AND NOT EXISTS (SELECT 1 FROM album_folder x WHERE x.album_id = af.album_id AND x.folder_id = (SELECT id FROM n))`,
      [from, to],
    );
    moves.push({ from, to, assets, albums: remapped.rowCount ?? 0 });
  }

  // Log only the top-most moved folder of each moved tree.
  const top = moves.filter((move) => {
    const parent = path.posix.dirname(move.from);
    const parentMove = consistent.get(parent);
    return !(parentMove && path.posix.dirname(move.to) === parentMove.to);
  });
  for (const move of top) {
    const albums = moves
      .filter((other) => other.from === move.from || other.from.startsWith(`${move.from}/`))
      .reduce((sum, other) => sum + other.albums, 0);
    move.albums = albums;
    await pool.query('INSERT INTO folder_move (from_path, to_path, assets, albums) VALUES ($1, $2, $3, $4)', [
      move.from,
      move.to,
      move.assets,
      albums,
    ]);
  }
  return top;
}
