import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { HealthResponse } from '@gallery/shared';

export interface AppOptions {
  pool: Pool;
  version: string;
  logger?: boolean | { level: string };
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

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

  return app;
}
