import path from 'node:path';
import { DEFAULT_SCAN_EXCLUDE, normalizeExcludeNames } from './scan/excludes.js';

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Cloudflare R2 accepts `auto`; MinIO ignores it. */
  region: string;
}

export type R2Mode = 'off' | 's3' | 'worker';

export interface WorkerUploadConfig {
  /** e.g. https://johorstudio.com/s/_r2 — the Worker route that writes R2. */
  uploadUrl: string;
  /** Sent as X-Upload-Secret. Never committed or logged. */
  secret: string;
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
  /** SvelteKit build output served at `/s` (default: apps/web/build). */
  webDir: string;
  thumbConcurrency: number;
  /** 0 disables the periodic scan. */
  scanIntervalMin: number;
  /** Directory names (case-insensitive, any depth) that are never scanned. */
  scanExclude: string[];
  /** Trust X-Forwarded-For / CF-Connecting-IP when resolving the client IP. */
  trustProxy: boolean;
  /** Reject requests that do not carry the Worker's X-Origin-Secret (health is exempt). */
  originSecret?: string;
  /** Prefix in front of `/<derivKey>/<size>.webp` in API responses. */
  thumbBase: string;
  /** IANA zone used for month/folder buckets. */
  timezone: string;
  r2Mode: R2Mode;
  r2?: R2Config;
  workerUpload?: WorkerUploadConfig;
}

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const DEFAULT_WORKER_UPLOAD_URL = 'https://johorstudio.com/s/_r2';
const DEFAULT_THUMB_BASE = '/s/t';
const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur';

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

function booleanFlag(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  throw new Error(`${name} must be 0|1|true|false, got ${JSON.stringify(raw)}`);
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

export function parseScanExclude(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_SCAN_EXCLUDE];
  return normalizeExcludeNames(raw.split(','));
}

function parseTimezone(raw: string | undefined): string {
  const timezone = raw?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`TIMEZONE is not a valid IANA zone: ${JSON.stringify(timezone)}`);
  }
  return timezone;
}

function parseThumbBase(raw: string | undefined): string {
  const value = (raw?.trim() || DEFAULT_THUMB_BASE).replace(/\/+$/, '');
  if (value === '') throw new Error('THUMB_BASE must not be empty');
  if (!value.startsWith('/') && !/^https?:\/\//.test(value)) {
    throw new Error(`THUMB_BASE must start with / or http(s)://, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function loadR2Mode(
  env: NodeJS.ProcessEnv,
  r2: R2Config | undefined,
): { mode: R2Mode; r2?: R2Config; workerUpload?: WorkerUploadConfig } {
  const explicit = env.R2_MODE?.trim().toLowerCase();
  if (explicit !== undefined && explicit !== '' && explicit !== 'off' && explicit !== 's3' && explicit !== 'worker') {
    throw new Error(`R2_MODE must be off|s3|worker, got ${JSON.stringify(env.R2_MODE)}`);
  }
  const mode: R2Mode = explicit === '' || explicit === undefined ? (r2 ? 's3' : 'off') : (explicit as R2Mode);

  if (mode === 'off') return { mode };
  if (mode === 's3') {
    if (!r2) {
      throw new Error(
        'R2_MODE=s3 requires R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY',
      );
    }
    return { mode, r2 };
  }

  const uploadUrl = (env.WORKER_UPLOAD_URL?.trim() || DEFAULT_WORKER_UPLOAD_URL).replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/.test(uploadUrl)) {
    throw new Error(`WORKER_UPLOAD_URL must be an http(s) URL, got ${JSON.stringify(env.WORKER_UPLOAD_URL)}`);
  }
  const secret = env.UPLOAD_SECRET?.trim();
  if (!secret) throw new Error('R2_MODE=worker requires UPLOAD_SECRET');
  return { mode, workerUpload: { uploadUrl, secret } };
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
  const r2Selection = loadR2Mode(env, r2);
  const originSecret = env.ORIGIN_SECRET?.trim();

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl,
    version: env.APP_VERSION ?? '0.1.0',
    logLevel,
    dataDir: resolveDir(env.DATA_DIR?.trim() || 'data'),
    webDir: resolveDir(env.WEB_DIR?.trim() || 'apps/web/build'),
    thumbConcurrency: positiveInteger('THUMB_CONCURRENCY', env.THUMB_CONCURRENCY, 1),
    scanIntervalMin,
    scanExclude: parseScanExclude(env.SCAN_EXCLUDE),
    trustProxy: booleanFlag('TRUST_PROXY', env.TRUST_PROXY, true),
    thumbBase: parseThumbBase(env.THUMB_BASE),
    timezone: parseTimezone(env.TIMEZONE),
    r2Mode: r2Selection.mode,
    ...(sourceRoot ? { sourceRoot: resolveDir(sourceRoot) } : {}),
    ...(r2Selection.r2 ? { r2: r2Selection.r2 } : {}),
    ...(r2Selection.workerUpload ? { workerUpload: r2Selection.workerUpload } : {}),
    ...(originSecret ? { originSecret } : {}),
  };
}

export { DEFAULT_SCAN_EXCLUDE };
