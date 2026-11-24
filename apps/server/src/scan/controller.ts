import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { enqueueThumbnails } from '../jobs/boss.js';
import { scanLibrary } from './scanner.js';

export interface ScanControllerOptions {
  pool: Pool;
  boss: PgBoss;
  sourceRoot: string;
  dataDir: string;
  excludeDirectories: string[];
  logger?: { info: (message: string) => void; error: (message: string) => void };
}

export interface ScanController {
  /** false when a pass is already running in this process. */
  trigger(): Promise<boolean>;
  start(intervalMinutes: number): void;
  stop(): void;
}

/**
 * One scanner loop shared by the CLI/periodic timer and the admin rescan button.
 * `scanLibrary` itself takes a Postgres advisory lock, so two app instances
 * (or the CLI and the server) never scan at the same time.
 */
export function createScanController(options: ScanControllerOptions): ScanController {
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<boolean> => {
    if (running) return false;
    running = true;
    try {
      await scanLibrary({
        pool: options.pool,
        sourceRoot: options.sourceRoot,
        dataDir: options.dataDir,
        excludeDirectories: options.excludeDirectories,
        onAssetsChanged: async (assetIds) => {
          await enqueueThumbnails(options.boss, assetIds);
        },
        ...(options.logger ? { logger: options.logger } : {}),
      });
      return true;
    } catch (error) {
      options.logger?.error(`scan failed: ${(error as Error).message}`);
      return false;
    } finally {
      running = false;
    }
  };

  return {
    async trigger(): Promise<boolean> {
      if (running) return false;
      void run();
      return true;
    },
    start(intervalMinutes: number): void {
      if (timer) return;
      timer = setInterval(() => void run(), intervalMinutes * 60_000);
      timer.unref();
      void run();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
