export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  version: string;
  logLevel: string;
}

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

/**
 * Config comes from env only (AGENTS §5). Values listed in `.env.example`.
 * Throws on invalid input instead of starting with a half-usable server.
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

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    databaseUrl,
    version: env.APP_VERSION ?? '0.1.0',
    logLevel,
  };
}
