import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { startWorker } from './jobs/worker.js';
import { createUploader } from './r2/uploader.js';

const config = loadConfig();
if (!config.sourceRoot) {
  console.error('SOURCE_ROOT is required for `npm run worker` (see .env.example)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Math.max(4, config.thumbConcurrency + 2),
  connectionTimeoutMillis: 5_000,
});

const uploader = createUploader(config);
const boss = await startWorker({
  databaseUrl: config.databaseUrl,
  pool,
  sourceRoot: config.sourceRoot,
  dataDir: config.dataDir,
  thumbConcurrency: config.thumbConcurrency,
  ...(uploader ? { uploader } : {}),
});

console.info(
  `worker: ready thumbConcurrency=${config.thumbConcurrency} r2=${config.r2Mode} ` +
    `dataDir=${config.dataDir}`,
);

async function shutdown(signal: string): Promise<void> {
  console.info(`worker: ${signal}, draining`);
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('worker: shutdown failed', error);
        process.exit(1);
      });
  });
}
