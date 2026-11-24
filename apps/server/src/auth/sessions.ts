import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

export const SESSION_COOKIE = 'gallery_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AdminSession {
  sessionId: string;
  adminId: string;
  username: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Raw token goes only to the cookie; the database stores its sha256. */
export async function createSession(
  pool: Pool,
  adminId: string,
  options: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1_000);
  await pool.query(
    `INSERT INTO admin_session (token_hash, admin_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenHash(token), adminId, expiresAt, options.ip ?? null, options.userAgent?.slice(0, 512) ?? null],
  );
  return { token, expiresAt };
}

export async function findSession(pool: Pool, token: string): Promise<AdminSession | null> {
  const { rows } = await pool.query<{
    id: string;
    admin_id: string;
    username: string;
    stale: boolean;
  }>(
    `SELECT s.id, s.admin_id, a.username, (s.last_seen_at < now() - interval '1 day') AS stale
     FROM admin_session s
     JOIN admin a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.stale) {
    await pool
      .query('UPDATE admin_session SET last_seen_at = now() WHERE id = $1', [row.id])
      .catch(() => undefined);
  }
  return { sessionId: row.id, adminId: row.admin_id, username: row.username };
}

export async function destroySession(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM admin_session WHERE token_hash = $1', [tokenHash(token)]);
}

export async function destroyExpiredSessions(pool: Pool): Promise<number> {
  const result = await pool.query('DELETE FROM admin_session WHERE expires_at <= now()');
  return result.rowCount ?? 0;
}
