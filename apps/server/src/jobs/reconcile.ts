import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { enqueueR2Uploads, enqueueThumbnails, QUEUE_R2, QUEUE_THUMB } from './boss.js';

export interface ReconcileOptions {
  pool: Pool;
  boss: PgBoss;
  r2Enabled: boolean;
  /** Refill only when fewer than this many jobs are waiting or running. */
  lowWater?: number;
  /** Assets queued per refill. */
  batchSize?: number;
  /** Give up on a file after this many failed attempts. */
  maxAttempts?: number;
  /** Re-queue an asset whose previous job vanished after this long. */
  staleMinutes?: number;
}

export interface ReconcileResult {
  thumbs: number;
  r2: number;
}

/** Jobs that are still waiting or running for a queue (pg-boss keeps them in pgboss.job). */
export async function pendingJobs(pool: Pool, queue: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state IN ('created', 'retry', 'active')`,
    [queue],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Feeds assets that still need work into the queues, newest photos first.
 * Only refills when the queue is nearly empty, so a slow NAS never gets a backlog of
 * duplicate jobs; `*_queued_at` guards against re-queueing work that is still in flight.
 */
export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const lowWater = options.lowWater ?? 50;
  const batchSize = options.batchSize ?? 500;
  const maxAttempts = options.maxAttempts ?? 5;
  const staleMinutes = options.staleMinutes ?? 360;
  const result: ReconcileResult = { thumbs: 0, r2: 0 };

  if ((await pendingJobs(options.pool, QUEUE_THUMB)) < lowWater) {
    const { rows } = await options.pool.query<{ id: string }>(
      `UPDATE asset SET thumb_queued_at = now()
       WHERE id IN (
         SELECT id FROM asset
         WHERE deleted_at IS NULL AND thumb_ok = false AND thumb_attempts < $1
           AND (thumb_queued_at IS NULL OR thumb_queued_at < now() - make_interval(mins => $2))
         ORDER BY taken_at DESC NULLS LAST, id
         LIMIT $3
         FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [maxAttempts, staleMinutes, batchSize],
    );
    if (rows.length > 0) result.thumbs = await enqueueThumbnails(options.boss, rows.map((row) => String(row.id)));
  }

  if (options.r2Enabled && (await pendingJobs(options.pool, QUEUE_R2)) < lowWater) {
    const { rows } = await options.pool.query<{ id: string }>(
      `UPDATE asset SET r2_queued_at = now()
       WHERE id IN (
         SELECT id FROM asset
         WHERE deleted_at IS NULL AND thumb_ok = true AND r2_ok = false
           AND (r2_queued_at IS NULL OR r2_queued_at < now() - make_interval(mins => $1))
         ORDER BY id DESC
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [staleMinutes, batchSize],
    );
    if (rows.length > 0) result.r2 = await enqueueR2Uploads(options.boss, rows.map((row) => String(row.id)));
  }

  return result;
}

/** Runs `reconcile` now and then every `intervalSeconds`; logs only when something was queued. */
export function startReconciler(
  options: ReconcileOptions & { intervalSeconds?: number; log?: (message: string) => void },
): () => void {
  const log = options.log ?? ((message: string) => console.info(message));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const queued = await reconcile(options);
      if (queued.thumbs > 0 || queued.r2 > 0) log(`reconcile: queued thumbs=${queued.thumbs} r2=${queued.r2}`);
    } catch (error) {
      console.error(`reconcile: failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), (options.intervalSeconds ?? 60) * 1_000);
  timer.unref();
  return () => clearInterval(timer);
}
