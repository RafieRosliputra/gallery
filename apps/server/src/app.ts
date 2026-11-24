import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { Pool } from 'pg';
import type { HealthResponse } from '@gallery/shared';
import { registerAuthRoutes, type AuthDeps } from './auth/routes.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerOriginalRoutes } from './api/originals.js';
import { registerPublicRoutes } from './api/public.js';
import { registerZipRoute } from './api/zip.js';
import { safeEqualString } from './security.js';

export interface AppOptions {
  pool: Pool;
  version: string;
  logger?: boolean | { level: string };
  /** Default true: the Worker/cloudflared sits in front of Fastify. */
  trustProxy?: boolean;
  /** When set, every request except /s/api/health must carry X-Origin-Secret. */
  originSecret?: string;
  /** DATA_DIR; defaults to `data` relative to the process cwd (read-only API use). */
  dataDir?: string;
  sourceRoot?: string;
  thumbBase?: string;
  timezone?: string;
  r2Enabled?: boolean;
  triggerScan?: () => Promise<boolean>;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const trustProxy = options.trustProxy ?? true;
  const app = Fastify({ logger: options.logger ?? false, trustProxy });

  void app.register(cookie);

  const auth: AuthDeps = { pool: options.pool, trustProxy };

  if (options.originSecret) {
    const secret = options.originSecret;
    app.addHook('onRequest', async (request, reply) => {
      const pathname = request.raw.url?.split('?')[0] ?? '';
      if (pathname === '/s/api/health') return;
      const header = request.headers['x-origin-secret'];
      if (typeof header !== 'string' || !safeEqualString(header, secret)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Permintaan hanya melalui johorstudio.com.' });
      }
    });
  }

  app.get('/s/api/health', async (request, reply) => {
    let db: HealthResponse['db'] = 'down';
    try {
      await options.pool.query('SELECT 1');
      db = 'up';
    } catch (error) {
      request.log.warn({ err: error }, 'health check: database unreachable');
    }

    const body: HealthResponse = { ok: db === 'up', version: options.version, db };
    return reply.code(db === 'up' ? 200 : 503).send(body);
  });

  const dataDir = options.dataDir ?? path.resolve('data');
  const thumbBase = (options.thumbBase ?? '/s/t').replace(/\/+$/, '');
  const timezone = options.timezone ?? 'Asia/Kuala_Lumpur';

  registerAuthRoutes(app, auth);
  registerPublicRoutes(app, { pool: options.pool, auth, thumbBase, timezone });
  registerOriginalRoutes(app, {
    pool: options.pool,
    auth,
    dataDir,
    ...(options.sourceRoot ? { sourceRoot: options.sourceRoot } : {}),
  });
  registerZipRoute(app, {
    pool: options.pool,
    dataDir,
    ...(options.sourceRoot ? { sourceRoot: options.sourceRoot } : {}),
  });
  registerAdminRoutes(app, {
    pool: options.pool,
    auth,
    timezone,
    r2Enabled: options.r2Enabled ?? false,
    ...(options.triggerScan ? { triggerScan: options.triggerScan } : {}),
  });

  return app;
}
