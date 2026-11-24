import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { SCAN_LOCK_NAME, scanLibrary } from '../src/scan/scanner.ts';
import { createPool, resetAndMigrate } from './helpers/db.ts';
import { writeJpeg } from './helpers/fixtures.ts';

describe('scan exclusions and advisory lock', () => {
  let pool: Pool;
  let sourceRoot: string;
  let dataDir: string;

  beforeAll(async () => {
    await resetAndMigrate();
    pool = createPool(4);
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'scan-source-'));
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'scan-data-'));

    await writeJpeg(path.join(sourceRoot, 'normal/a.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, 'deep/ok/e.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, 'immich/library/photo.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, 'deep/immich/d.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, '@eaDir/b.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, '#recycle/c.jpg'), 40, 30);
    await writeJpeg(path.join(sourceRoot, 'skip/f.jpg'), 40, 30);
  });

  afterAll(async () => {
    await pool.end();
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('skips SCAN_EXCLUDE directories at any depth', async () => {
    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    // `skip` is not in the default list; @eaDir is ignored by the walker itself.
    expect(stats).toMatchObject({ scanned: 3, added: 3, errors: 0 });
    const { rows } = await pool.query<{ path: string }>('SELECT path FROM asset ORDER BY path');
    expect(rows.map((row) => row.path)).toEqual(['deep/ok/e.jpg', 'normal/a.jpg', 'skip/f.jpg']);
  });

  it('uses a custom SCAN_EXCLUDE list instead of the default and soft-deletes newly excluded rows', async () => {
    const custom = await scanLibrary({
      pool,
      sourceRoot,
      dataDir,
      excludeDirectories: ['skip', '#recycle'],
    });
    // skip/f.jpg is excluded, the two immich photos are now allowed.
    expect(custom).toMatchObject({ scanned: 4, added: 2, deleted: 1, errors: 0 });

    const backToDefault = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(backToDefault.deleted).toBe(2);
    const { rows } = await pool.query<{ path: string; deleted: boolean }>(
      'SELECT path, deleted_at IS NOT NULL AS deleted FROM asset ORDER BY path',
    );
    expect(rows).toEqual([
      { path: 'deep/immich/d.jpg', deleted: true },
      { path: 'deep/ok/e.jpg', deleted: false },
      { path: 'immich/library/photo.jpg', deleted: true },
      { path: 'normal/a.jpg', deleted: false },
      { path: 'skip/f.jpg', deleted: false },
    ]);
  });

  it('serializes scan passes with the shared Postgres advisory lock', async () => {
    const lock = await pool.connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtext($1))', [SCAN_LOCK_NAME]);
      let settled = false;
      const pending = scanLibrary({ pool, sourceRoot, dataDir }).then((stats) => {
        settled = true;
        return stats;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [SCAN_LOCK_NAME]);
      const stats = await pending;
      expect(stats.scanned).toBe(3);
    } finally {
      await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [SCAN_LOCK_NAME]).catch(() => undefined);
      lock.release();
    }
  }, 15_000);
});
