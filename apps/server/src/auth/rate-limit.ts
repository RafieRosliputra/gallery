import type { Pool } from 'pg';

export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES = 5;

export interface LoginBlock {
  blocked: boolean;
  retryAfterSeconds: number;
}

/** 5 failures in the last 15 minutes blocks the next login from that IP. */
export async function checkLoginBlock(pool: Pool, ip: string): Promise<LoginBlock> {
  const { rows } = await pool.query<{ failures: number; oldest: Date | null }>(
    `SELECT count(*)::int AS failures, min(created_at) AS oldest
     FROM login_failure
     WHERE ip = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [ip, String(LOGIN_WINDOW_MINUTES)],
  );
  const row = rows[0];
  if (!row || row.failures < LOGIN_MAX_FAILURES) return { blocked: false, retryAfterSeconds: 0 };
  const unlockAt = (row.oldest?.getTime() ?? Date.now()) + LOGIN_WINDOW_MINUTES * 60_000;
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((unlockAt - Date.now()) / 1_000)),
  };
}

export async function recordLoginFailure(pool: Pool, ip: string): Promise<void> {
  await pool.query('INSERT INTO login_failure (ip) VALUES ($1)', [ip]);
  // Keep the table bounded; only this IP's ancient rows matter for correctness.
  await pool
    .query("DELETE FROM login_failure WHERE ip = $1 AND created_at < now() - interval '1 day'", [ip])
    .catch(() => undefined);
}

export async function clearLoginFailures(pool: Pool, ip: string): Promise<void> {
  await pool.query('DELETE FROM login_failure WHERE ip = $1', [ip]);
}
