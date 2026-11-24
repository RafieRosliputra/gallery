import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/passwords.ts';
import { createSession } from '../src/auth/sessions.ts';
import { createPool, resetAndMigrate } from './helpers/db.ts';

const USERNAME = 'rafi-admin';
const PASSWORD = 'kata-laluan-uji-2026';

describe('auth', () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    await resetAndMigrate();
    pool = createPool();
    const hash = await hashPassword(PASSWORD);
    await pool.query('INSERT INTO admin (username, pw_hash) VALUES ($1, $2)', [USERNAME, hash]);
    app = buildApp({ pool, version: 'test' });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('logs in with argon2id and sets the hardened session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: PASSWORD },
      headers: { 'x-forwarded-for': '10.1.0.1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ admin: { id: expect.any(String), username: USERNAME } });

    const cookie = response.cookies.find((item) => item.name === 'gallery_session');
    expect(cookie?.value).toEqual(expect.any(String));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/s');
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);

    const session = await app.inject({
      method: 'GET',
      url: '/s/api/auth/session',
      headers: { cookie: `gallery_session=${cookie?.value ?? ''}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ admin: { id: expect.any(String), username: USERNAME } });
  });

  it('rejects a wrong password and an unknown username with 401', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: 'not-the-password' },
      headers: { 'x-forwarded-for': '10.1.0.2' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: 'invalid_credentials' });

    const unknown = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: 'nobody', password: PASSWORD },
      headers: { 'x-forwarded-for': '10.1.0.3' },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('blocks the sixth attempt after 5 failures in 15 minutes per IP', async () => {
    const ip = '10.2.0.1';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/s/api/auth/login',
        payload: { username: USERNAME, password: 'wrong' },
        headers: { 'x-forwarded-for': ip },
      });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: PASSWORD },
      headers: { 'x-forwarded-for': ip },
    });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    const otherIp = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: PASSWORD },
      headers: { 'x-forwarded-for': '10.2.0.2' },
    });
    expect(otherIp.statusCode).toBe(200);
  });

  it('clears failures after a successful login from the same IP', async () => {
    const ip = '10.3.0.1';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await app.inject({
        method: 'POST',
        url: '/s/api/auth/login',
        payload: { username: USERNAME, password: 'wrong' },
        headers: { 'x-forwarded-for': ip },
      });
    }
    const success = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: PASSWORD },
      headers: { 'x-forwarded-for': ip },
    });
    expect(success.statusCode).toBe(200);
    const after = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: 'wrong' },
      headers: { 'x-forwarded-for': ip },
    });
    expect(after.statusCode).toBe(401);
  });

  it('logout destroys the server-side session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/s/api/auth/login',
      payload: { username: USERNAME, password: PASSWORD },
      headers: { 'x-forwarded-for': '10.4.0.1' },
    });
    const token = login.cookies.find((item) => item.name === 'gallery_session')?.value ?? '';
    const logout = await app.inject({
      method: 'POST',
      url: '/s/api/auth/logout',
      headers: { cookie: `gallery_session=${token}` },
    });
    expect(logout.statusCode).toBe(204);
    const session = await app.inject({
      method: 'GET',
      url: '/s/api/auth/session',
      headers: { cookie: `gallery_session=${token}` },
    });
    expect(session.statusCode).toBe(401);
  });

  it('protects every /s/api/admin route', async () => {
    for (const url of ['/s/api/admin/status', '/s/api/admin/clients', '/s/api/admin/albums', '/s/api/admin/folders', '/s/api/admin/buckets']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
    const rescan = await app.inject({ method: 'POST', url: '/s/api/admin/rescan' });
    expect(rescan.statusCode).toBe(401);
  });

  it('rejects an expired session and accepts a live one', async () => {
    const admin = await pool.query<{ id: string }>('SELECT id FROM admin WHERE username = $1', [USERNAME]);
    const session = await createSession(pool, admin.rows[0]?.id ?? '');
    const hash = createHash('sha256').update(session.token).digest('hex');
    await pool.query("UPDATE admin_session SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hash]);
    const expired = await app.inject({
      method: 'GET',
      url: '/s/api/admin/status',
      headers: { cookie: `gallery_session=${session.token}` },
    });
    expect(expired.statusCode).toBe(401);
  });
});
