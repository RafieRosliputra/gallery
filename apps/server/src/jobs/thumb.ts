import type { Pool } from 'pg';
import { resolveInside } from '../scan/paths.js';
import { generateDerivatives, type DerivativeResult } from '../thumbs/generate.js';
import { recordJobError } from './errors.js';

export interface ThumbJobInput {
  pool: Pool;
  sourceRoot: string;
  dataDir: string;
  assetId: string;
}

export async function processThumbJob(input: ThumbJobInput): Promise<DerivativeResult | null> {
  const { rows } = await input.pool.query<{ id: string; path: string; deriv_key: string }>(
    'SELECT id, path, deriv_key FROM asset WHERE id = $1 AND deleted_at IS NULL',
    [input.assetId],
  );
  const asset = rows[0];
  if (!asset) return null;

  try {
    const sourcePath = resolveInside(input.sourceRoot, asset.path);
    const result = await generateDerivatives({
      sourcePath,
      sourceRoot: input.sourceRoot,
      dataDir: input.dataDir,
      derivKey: asset.deriv_key,
    });
    const updated = await input.pool.query(
      `UPDATE asset SET thumbhash = $2, thumb_ok = true, scanned_at = now()
       WHERE id = $1 AND deriv_key = $3`,
      [asset.id, result.thumbhash, asset.deriv_key],
    );
    // The file changed under us: leave the new deriv_key queued instead of
    // uploading derivatives for the stale key.
    return updated.rowCount === 1 ? result : null;
  } catch (error) {
    const message = (error as Error).message;
    console.error(`thumb: asset ${asset.id} (${asset.path}) failed: ${message}`);
    await recordJobError(input.pool, 'thumb', message, asset.id);
    // Counted so the reconciler stops re-feeding a file that can never be decoded.
    await input.pool
      .query('UPDATE asset SET thumb_attempts = thumb_attempts + 1 WHERE id = $1', [asset.id])
      .catch(() => undefined);
    throw error;
  }
}
