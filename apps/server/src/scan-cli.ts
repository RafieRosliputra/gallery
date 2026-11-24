import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { enqueueThumbnails, createBoss, ensureQueues } from './jobs/boss.js';
import { scanLibrary } from './scan/scanner.js';

const config = loadConfig();
if (!config.sourceRoot) {
  console.error('SOURCE_ROOT is required for `npm run scan` (see .env.example)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5_000,
});
const boss = createBoss(config.databaseUrl);

try {
  await boss.start();
  await ensureQueues(boss);
  const stats = await scanLibrary({
    pool,
    sourceRoot: config.sourceRoot,
    dataDir: config.dataDir,
    excludeDirectories: config.scanExclude,
    onAssetsChanged: async (assetIds) => {
      const queued = await enqueueThumbnails(boss, assetIds);
      console.info(`scan: queued ${queued} thumbnail jobs`);
    },
    logger: {
      info: (message) => console.info(message),
      error: (message) => console.error(message),
    },
  });
  console.log(`scan: ${JSON.stringify(stats)}`);
} catch (error) {
  console.error('scan: failed', error);
  process.exitCode = 1;
} finally {
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end().catch(() => undefined);
}
