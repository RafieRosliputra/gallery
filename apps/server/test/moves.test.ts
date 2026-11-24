import { copyFile, mkdir, mkdtemp, rename, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { scanLibrary } from '../src/scan/scanner.ts';
import { folderPairs } from '../src/scan/moves.ts';
import { createPool, resetAndMigrate } from './helpers/db.ts';
import { writeJpeg } from './helpers/fixtures.ts';

describe('move detection', () => {
  let pool: Pool;
  let sourceRoot: string;
  let dataDir: string;

  const idOf = async (file: string) =>
    (await pool.query<{ id: string }>('SELECT id::text AS id FROM asset WHERE path = $1', [file])).rows[0]?.id;

  beforeAll(async () => {
    await resetAndMigrate();
    pool = createPool(4);
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'moves-source-'));
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'moves-data-'));
    await writeJpeg(path.join(sourceRoot, 'ssd/Event X/Cam 1/a.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, 'ssd/Event X/b.jpg'), 50, 30);
    await writeJpeg(path.join(sourceRoot, 'ssd/Other/c.jpg'), 60, 30);
    await mkdir(path.join(sourceRoot, 'hdd/2026'), { recursive: true });
  });

  afterAll(async () => {
    await pool.end();
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('derives old→new folder pairs from one moved file', () => {
    expect(folderPairs('ssd/Event X/Cam 1/a.jpg', 'hdd/2026/Event X/Cam 1/a.jpg')).toEqual([
      ['ssd/Event X/Cam 1', 'hdd/2026/Event X/Cam 1'],
      ['ssd/Event X', 'hdd/2026/Event X'],
      ['ssd', 'hdd/2026'],
    ]);
    expect(folderPairs('a/x.jpg', 'a/y/x.jpg')).toEqual([['a', 'a/y']]);
  });

  it('keeps asset ids when a folder is renamed and moves album rules with it', async () => {
    await scanLibrary({ pool, sourceRoot, dataDir });
    const a = await idOf('ssd/Event X/Cam 1/a.jpg');
    const b = await idOf('ssd/Event X/b.jpg');
    const client = await pool.query<{ id: string }>("INSERT INTO client (name, slug) VALUES ('M', 'move-client') RETURNING id");
    const album = await pool.query<{ id: string }>(
      "INSERT INTO album (client_id, title, slug) VALUES ($1, 'Event X', 'move-album') RETURNING id",
      [client.rows[0]?.id],
    );
    const albumId = album.rows[0]?.id;
    await pool.query(
      "INSERT INTO album_folder (album_id, folder_id, recursive) SELECT $1, id, true FROM folder WHERE path = 'ssd/Event X'",
      [albumId],
    );

    await rename(path.join(sourceRoot, 'ssd/Event X'), path.join(sourceRoot, 'hdd/2026/Event X'));
    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(stats).toMatchObject({ moved: 2, deleted: 0, errors: 0 });
    expect(await idOf('hdd/2026/Event X/Cam 1/a.jpg')).toBe(a);
    expect(await idOf('hdd/2026/Event X/b.jpg')).toBe(b);

    const rule = await pool.query<{ path: string }>(
      'SELECT f.path FROM album_folder af JOIN folder f ON f.id = af.folder_id WHERE af.album_id = $1',
      [albumId],
    );
    expect(rule.rows.map((row) => row.path)).toEqual(['hdd/2026/Event X']);
    const scope = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM asset WHERE deleted_at IS NULL AND folder_id IN (SELECT fid FROM album_scope($1))',
      [albumId],
    );
    expect(scope.rows[0]?.n).toBe(2);

    const logged = await pool.query('SELECT from_path, to_path, assets, albums FROM folder_move');
    expect(logged.rows).toEqual([{ from_path: 'ssd/Event X', to_path: 'hdd/2026/Event X', assets: 2, albums: 1 }]);
  });

  it('merges a copy-then-delete move across two scans into the original asset', async () => {
    const c = await idOf('ssd/Other/c.jpg');
    const from = path.join(sourceRoot, 'ssd/Other/c.jpg');
    const to = path.join(sourceRoot, 'hdd/Other/c.jpg');
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
    const info = await stat(from);
    // Copy tools round mtime; matching tolerates that.
    await utimes(to, info.atime, new Date(info.mtime.getTime() + 700));

    const copied = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(copied).toMatchObject({ added: 1, moved: 0 });

    await rm(from);
    const moved = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(moved).toMatchObject({ moved: 1, deleted: 0 });
    expect(await idOf('hdd/Other/c.jpg')).toBe(c);
    const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM asset WHERE path LIKE '%/c.jpg'");
    expect(count.rows[0]?.n).toBe(1);
  });
});
