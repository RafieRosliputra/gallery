import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createBoss, ensureQueues } from './jobs/boss.js';
import { createScanController, type ScanController } from './scan/controller.js';

const config = loadConfig();
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5_000,
});

let boss: ReturnType<typeof createBoss> | undefined;
let scan: ScanController | undefined;

if (config.sourceRoot) {
  try {
    boss = createBoss(config.databaseUrl);
    await boss.start();
    await ensureQueues(boss);
    scan = createScanController({
      pool,
      boss,
      sourceRoot: config.sourceRoot,
      dataDir: config.dataDir,
      excludeDirectories: config.scanExclude,
      logger: {
        info: (message) => console.log(message),
        error: (message) => console.error(message),
      },
    });
  } catch (error) {
    console.error('scanner: pg-boss failed to start; periodic scan and rescan are disabled', error);
    await boss?.stop({ graceful: false }).catch(() => undefined);
    boss = undefined;
    scan = undefined;
  }
}

const app = buildApp({
  pool,
  version: config.version,
  logger: { level: config.logLevel },
  trustProxy: config.trustProxy,
  dataDir: config.dataDir,
  webDir: config.webDir,
  thumbBase: config.thumbBase,
  timezone: config.timezone,
  r2Enabled: config.r2Mode !== 'off',
  excludeDirectories: config.scanExclude,
  ...(config.originSecret ? { originSecret: config.originSecret } : {}),
  ...(config.sourceRoot ? { sourceRoot: config.sourceRoot } : {}),
  ...(scan ? { triggerScan: () => scan.trigger() } : {}),
});

if (scan && config.scanIntervalMin > 0) {
  scan.start(config.scanIntervalMin);
  app.log.info(`periodic scan: every ${config.scanIntervalMin} min`);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  scan?.stop();
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
