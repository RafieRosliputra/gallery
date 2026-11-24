import type { Pool } from 'pg';

/** Bounded error feed; every failure keeps the asset id and a truncated message. */
export async function recordJobError(
  pool: Pool,
  source: string,
  message: string,
  assetId?: string,
): Promise<void> {
  await pool
    .query('INSERT INTO job_error (source, message, asset_id) VALUES ($1, $2, $3)', [
      source,
      message.slice(0, 2_000),
      assetId ?? null,
    ])
    .catch(() => undefined);
}
