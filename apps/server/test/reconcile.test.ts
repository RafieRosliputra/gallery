import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { createBoss, ensureQueues, QUEUE_THUMB } from '../src/jobs/boss.ts';
import { pendingJobs, reconcile } from '../src/jobs/reconcile.ts';
import { startWorker } from '../src/jobs/worker.ts';
import { scanLibrary } from '../src/scan/scanner.ts';
import { createPool, resetAndMigrate } from './helpers/db.ts';
import { writeJpeg } from './helpers/fixtures.ts';

// Production incident 2026-11-25: redeploys dropped in-flight pg-boss jobs, leaving
// 21k assets with thumb_ok = false and an empty queue. The reconciler must refill it.
describe('reconciler re-feeds lost thumbnail jobs', () => {
  let pool: Pool;
  let sourceRoot: string;
  let dataDir: string;
  let boss: PgBoss;
  let workerBoss: PgBoss | null = null;

  beforeAll(async () => {
    await resetAndMigrate();
    pool = createPool(6);
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'gallery-reconcile-src-'));
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'gallery-reconcile-data-'));
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'broken.jpg']) {
      await writeJpeg(path.join(sourceRoot, 'Klien Demo', name), 320, 240);
    }
    // Scan WITHOUT enqueueing: exactly the "jobs were lost" state.
    await scanLibrary({ pool, sourceRoot, dataDir, onAssetsChanged: async () => undefined });
    boss = createBoss(process.env.DATABASE_URL ?? '');
    await boss.start();
    await ensureQueues(boss);
  });

  afterAll(async () => {
    await workerBoss?.stop({ graceful: false }).catch(() => undefined);
    await boss?.stop({ graceful: false }).catch(() => undefined);
    await pool?.end();
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('skips assets that already failed too often', async () => {
    await pool.query(`UPDATE asset SET thumb_attempts = 5 WHERE path LIKE '%broken.jpg'`);
    expect(await pendingJobs(pool, QUEUE_THUMB)).toBe(0);
  });

  it('queues every pending asset once, and not again while in flight', async () => {
    const first = await reconcile({ pool, boss, r2Enabled: false });
    expect(first).toEqual({ thumbs: 3, r2: 0 });
    expect(await pendingJobs(pool, QUEUE_THUMB)).toBe(3);

    const second = await reconcile({ pool, boss, r2Enabled: false });
    expect(second).toEqual({ thumbs: 0, r2: 0 });
  });

  it('re-queues an asset whose job vanished after the stale window', async () => {
    await pool.query(`UPDATE asset SET thumb_queued_at = now() - interval '7 hours' WHERE path LIKE '%a.jpg'`);
    const again = await reconcile({ pool, boss, r2Enabled: false });
    expect(again.thumbs).toBe(1);
  });

  it('the worker drains the refilled queue', async () => {
    workerBoss = await startWorker({
      databaseUrl: process.env.DATABASE_URL ?? '',
      pool,
      sourceRoot,
      dataDir,
      thumbConcurrency: 1,
    });
    const deadline = Date.now() + 30_000;
    let done = 0;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM asset WHERE thumb_ok = true AND path NOT LIKE '%broken.jpg'`,
      );
      done = rows[0]?.n ?? 0;
      if (done === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(done).toBe(3);
  });
});
