import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { enqueueThumbnails } from '../jobs/boss.js';
import { scanLibrary } from './scanner.js';

export interface PeriodicScanOptions {
  pool: Pool;
  boss: PgBoss;
  sourceRoot: string;
  dataDir: string;
  intervalMinutes: number;
  logger?: { info: (message: string) => void; error: (message: string) => void };
}

/** Incremental scan every N minutes; a pass never overlaps the previous one. */
export function startPeriodicScan(options: PeriodicScanOptions): () => void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await scanLibrary({
        pool: options.pool,
        sourceRoot: options.sourceRoot,
        dataDir: options.dataDir,
        onAssetsChanged: async (assetIds) => {
          await enqueueThumbnails(options.boss, assetIds);
        },
        ...(options.logger ? { logger: options.logger } : {}),
      });
    } catch (error) {
      options.logger?.error(`periodic scan failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), options.intervalMinutes * 60_000);
  timer.unref();
  void run();

  return () => clearInterval(timer);
}
