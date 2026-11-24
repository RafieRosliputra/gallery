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
    await input.pool.query(
      `UPDATE asset SET thumbhash = $2, thumb_ok = true, scanned_at = now()
       WHERE id = $1 AND deriv_key = $3`,
      [asset.id, result.thumbhash, asset.deriv_key],
    );
    return result;
  } catch (error) {
    await recordJobError(input.pool, 'thumb', (error as Error).message, asset.id);
    throw error;
  }
}
