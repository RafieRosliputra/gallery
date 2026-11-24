import os from 'node:os';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import type { R2Config } from '../config.js';
import { createR2Uploader, type R2Uploader } from '../r2/uploader.js';
import { createBoss, enqueueR2Upload, ensureQueues, QUEUE_R2, QUEUE_THUMB } from './boss.js';
import { recordJobError } from './errors.js';
import { processThumbJob } from './thumb.js';

export interface WorkerOptions {
  databaseUrl: string;
  pool: Pool;
  sourceRoot: string;
  dataDir: string;
  thumbConcurrency: number;
  r2?: R2Config;
}

interface JobData {
  assetId: string;
}

/** Best effort: macOS may deny lowering the priority (EPERM) and Windows has no nice. */
function lowerProcessPriority(): void {
  try {
    os.setPriority(19);
  } catch (error) {
    console.warn(`worker: could not lower process priority: ${(error as Error).message}`);
  }
}

export async function startWorker(options: WorkerOptions): Promise<PgBoss> {
  lowerProcessPriority();
  const boss = createBoss(options.databaseUrl);
  await boss.start();
  await ensureQueues(boss);

  await boss.work<JobData>(
    QUEUE_THUMB,
    { batchSize: 1, localConcurrency: options.thumbConcurrency, pollingIntervalSeconds: 0.5 },
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const result = await processThumbJob({
        pool: options.pool,
        sourceRoot: options.sourceRoot,
        dataDir: options.dataDir,
        assetId: job.data.assetId,
      });
      if (result && options.r2) await enqueueR2Upload(boss, job.data.assetId);
    },
  );

  if (options.r2) {
    const uploader = createR2Uploader(options.r2);
    await boss.work<JobData>(QUEUE_R2, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 0.5 }, async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      await processR2Job(options.pool, uploader, options.dataDir, job.data.assetId);
    });
  } else {
    console.info('r2: disabled (R2_* env not set); uploads are skipped');
  }

  return boss;
}

async function processR2Job(
  pool: Pool,
  uploader: R2Uploader,
  dataDir: string,
  assetId: string,
): Promise<void> {
  const { rows } = await pool.query<{ id: string; deriv_key: string; thumb_ok: boolean }>(
    'SELECT id, deriv_key, thumb_ok FROM asset WHERE id = $1 AND deleted_at IS NULL',
    [assetId],
  );
  const asset = rows[0];
  if (!asset || !asset.thumb_ok) return;

  try {
    await uploader.upload(asset.deriv_key, dataDir);
    await pool.query('UPDATE asset SET r2_ok = true WHERE id = $1 AND deriv_key = $2', [
      asset.id,
      asset.deriv_key,
    ]);
  } catch (error) {
    await recordJobError(pool, 'r2', (error as Error).message, asset.id);
    throw error;
  }
}
