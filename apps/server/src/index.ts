import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createBoss, ensureQueues } from './jobs/boss.js';
import { startPeriodicScan } from './scan/periodic.js';

const config = loadConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5_000,
});

const app = buildApp({
  pool,
  version: config.version,
  logger: { level: config.logLevel },
  adminOpen: config.adminOpen,
});

let stopPeriodicScan: (() => void) | undefined;
let boss: ReturnType<typeof createBoss> | undefined;

if (config.sourceRoot && config.scanIntervalMin > 0) {
  try {
    boss = createBoss(config.databaseUrl);
    await boss.start();
    await ensureQueues(boss);
    stopPeriodicScan = startPeriodicScan({
      pool,
      boss,
      sourceRoot: config.sourceRoot,
      dataDir: config.dataDir,
      intervalMinutes: config.scanIntervalMin,
      logger: {
        info: (message) => app.log.info(message),
        error: (message) => app.log.error(message),
      },
    });
    app.log.info(`periodic scan: every ${config.scanIntervalMin} min`);
  } catch (error) {
    app.log.error({ err: error }, 'periodic scan disabled: pg-boss failed to start');
    await boss?.stop({ graceful: false }).catch(() => undefined);
    boss = undefined;
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  stopPeriodicScan?.();
  await app.close();
  await boss?.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed');
        process.exit(1);
      });
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'failed to start server');
  await pool.end();
  process.exit(1);
}
