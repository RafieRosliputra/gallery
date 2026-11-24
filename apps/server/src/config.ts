import path from 'node:path';

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Cloudflare R2 accepts `auto`; MinIO ignores it. */
  region: string;
}

export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  version: string;
  logLevel: string;
  /** Read-only photo root. Required by the scanner/worker CLIs, optional for the API-only server. */
  sourceRoot?: string;
  dataDir: string;
  thumbConcurrency: number;
  /** 0 disables the periodic scan. */
  scanIntervalMin: number;
  /** Phase 1b only: exposes /s/api/admin/status without auth. Never enable in production. */
  adminOpen: boolean;
  r2?: R2Config;
}

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function resolveDir(value: string): string {
  return path.resolve(value);
}

/**
 * R2 is all-or-nothing: a half-configured bucket is treated as "not configured"
 * so jobs are skipped cleanly instead of retrying into a guaranteed failure.
 */
export function loadR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | undefined {
  const endpoint = env.R2_ENDPOINT?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env.R2_REGION?.trim() || 'auto',
  };
}

/**
 * Config comes from env only (AGENTS §5). Values listed in `.env.example`.
 * Throws on invalid input instead of starting with a half-usable process.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (see .env.example)');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer 1-65535, got ${JSON.stringify(env.PORT)}`);
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join('|')}, got ${logLevel}`);
  }

  const scanIntervalMin = Number(env.SCAN_INTERVAL_MIN ?? 10);
  if (!Number.isInteger(scanIntervalMin) || scanIntervalMin < 0) {
    throw new Error(`SCAN_INTERVAL_MIN must be an integer >= 0, got ${JSON.stringify(env.SCAN_INTERVAL_MIN)}`);
  }

  const sourceRoot = env.SOURCE_ROOT?.trim();
  const r2 = loadR2Config(env);

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl,
    version: env.APP_VERSION ?? '0.1.0',
    logLevel,
    dataDir: resolveDir(env.DATA_DIR?.trim() || 'data'),
    thumbConcurrency: positiveInteger('THUMB_CONCURRENCY', env.THUMB_CONCURRENCY, 1),
    scanIntervalMin,
    adminOpen: env.ADMIN_OPEN === '1',
    ...(sourceRoot ? { sourceRoot: resolveDir(sourceRoot) } : {}),
    ...(r2 ? { r2 } : {}),
  };
}
