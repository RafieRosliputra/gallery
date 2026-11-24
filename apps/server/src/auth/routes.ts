import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AdminSessionResponse } from '@gallery/shared';
import { verifyAgainstDummy, verifyPassword } from './passwords.js';
import { checkLoginBlock, clearLoginFailures, recordLoginFailure } from './rate-limit.js';
import {
  createSession,
  destroyExpiredSessions,
  destroySession,
  findSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from './sessions.js';
import './types.js';

export interface AuthDeps {
  pool: Pool;
  trustProxy: boolean;
}

const COOKIE_OPTIONS = {
  path: '/s',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
} as const;

const INVALID_CREDENTIALS = 'Nama pengguna atau kata laluan tidak sah.';
const RATE_LIMITED = 'Terlalu banyak percubaan log masuk. Cuba lagi selepas 15 minit.';

export function clientIp(request: FastifyRequest, trustProxy: boolean): string {
  if (!trustProxy) return request.socket.remoteAddress ?? 'unknown';
  const cloudflare = request.headers['cf-connecting-ip'];
  if (typeof cloudflare === 'string' && cloudflare.trim() !== '') return cloudflare.trim();
  return request.ip;
}

function credentials(body: unknown): { username: string; password: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const username = record['username'];
  const password = record['password'];
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (username.length === 0 || username.length > 64 || password.length === 0 || password.length > 1_024) {
    return null;
  }
  return { username, password };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  app.post('/s/api/auth/login', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const input = credentials(request.body);
    if (!input) {
      return reply.code(400).send({ error: 'bad_request', message: 'Nama pengguna dan kata laluan diperlukan.' });
    }

    const ip = clientIp(request, deps.trustProxy);
    const block = await checkLoginBlock(deps.pool, ip);
    if (block.blocked) {
      return reply
        .code(429)
        .header('Retry-After', String(block.retryAfterSeconds))
        .send({ error: 'rate_limited', message: RATE_LIMITED });
    }

    const { rows } = await deps.pool.query<{ id: string; username: string; pw_hash: string }>(
      'SELECT id, username, pw_hash FROM admin WHERE username = $1',
      [input.username],
    );
    const admin = rows[0];
    let valid = false;
    if (admin) valid = await verifyPassword(admin.pw_hash, input.password);
    else await verifyAgainstDummy(input.password);

    if (!admin || !valid) {
      await recordLoginFailure(deps.pool, ip);
      request.log.warn({ ip, username: input.username }, 'login failed');
      return reply.code(401).send({ error: 'invalid_credentials', message: INVALID_CREDENTIALS });
    }

    await clearLoginFailures(deps.pool, ip);
    await destroyExpiredSessions(deps.pool).catch(() => undefined);
    const userAgent = request.headers['user-agent'];
    const session = await createSession(deps.pool, admin.id, {
      ip,
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    });
    reply.setCookie(SESSION_COOKIE, session.token, {
      ...COOKIE_OPTIONS,
      maxAge: SESSION_TTL_SECONDS,
    });

    const body: AdminSessionResponse = { admin: { id: admin.id, username: admin.username } };
    return reply.send(body);
  });

  app.post('/s/api/auth/logout', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const token = request.cookies[SESSION_COOKIE];
    if (typeof token === 'string' && token !== '') await destroySession(deps.pool, token);
    reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
    return reply.code(204).send();
  });

  app.get('/s/api/auth/session', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const session = await requireAdmin(request, reply, deps);
    if (!session) return reply;
    const body: AdminSessionResponse = {
      admin: { id: session.adminId, username: session.username },
    };
    return reply.send(body);
  });
}

/**
 * Shared preHandler for every /s/api/admin/* route. Returns the session, or
 * sends 401 and returns null. Sessions are checked against Postgres on each
 * request, so logout/revocation is immediate.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AuthDeps,
): Promise<import('./sessions.js').AdminSession | null> {
  reply.header('Cache-Control', 'no-store');
  const token = request.cookies[SESSION_COOKIE];
  if (typeof token !== 'string' || token === '') {
    reply.code(401).send({ error: 'unauthorized', message: 'Sesi tidak sah atau telah tamat.' });
    return null;
  }
  const session = await findSession(deps.pool, token);
  if (!session) {
    reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
    reply.code(401).send({ error: 'unauthorized', message: 'Sesi tidak sah atau telah tamat.' });
    return null;
  }
  request.adminSession = session;
  return session;
}

/** Best-effort session lookup for endpoints that are public to admins too. */
export async function optionalAdmin(
  request: FastifyRequest,
  deps: AuthDeps,
): Promise<import('./sessions.js').AdminSession | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (typeof token !== 'string' || token === '') return null;
  return findSession(deps.pool, token);
}
