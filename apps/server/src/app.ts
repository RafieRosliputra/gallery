import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AdminStatusResponse, HealthResponse } from '@gallery/shared';

export interface AppOptions {
  pool: Pool;
  version: string;
  logger?: boolean | { level: string };
  /** Phase 1b: /s/api/admin/status has no auth yet, so it stays closed by default. */
  adminOpen?: boolean;
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

  app.get('/s/api/admin/status', async (request, reply) => {
    if (options.adminOpen !== true) return reply.code(404).send({ error: 'not found' });

    try {
      const { rows } = await options.pool.query<{
        assets: number;
        pending_thumbs: number;
        pending_r2: number;
        last_scan_at: Date | null;
        errors24h: number;
      }>(
        `SELECT
           (SELECT count(*) FROM asset WHERE deleted_at IS NULL)::int AS assets,
           (SELECT count(*) FROM asset WHERE deleted_at IS NULL AND thumb_ok = false)::int AS pending_thumbs,
           (SELECT count(*) FROM asset WHERE deleted_at IS NULL AND thumb_ok = true AND r2_ok = false)::int AS pending_r2,
           (SELECT max(finished_at) FROM scan_run) AS last_scan_at,
           (SELECT count(*) FROM job_error WHERE created_at > now() - interval '24 hours')::int AS errors24h`,
      );
      const row = rows[0];
      if (!row) throw new Error('status query returned no rows');
      const body: AdminStatusResponse = {
        assets: row.assets,
        pendingThumbs: row.pending_thumbs,
        pendingR2: row.pending_r2,
        lastScanAt: row.last_scan_at ? row.last_scan_at.toISOString() : null,
        errors24h: row.errors24h,
      };
      return reply.send(body);
    } catch (error) {
      request.log.error({ err: error }, 'status query failed');
      return reply.code(503).send({ error: 'status unavailable' });
    }
  });

  return app;
}
