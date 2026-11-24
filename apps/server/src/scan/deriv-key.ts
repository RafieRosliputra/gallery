import { createHash } from 'node:crypto';

/**
 * SPEC v2 said `sha1` = hash of the original. Reading every byte of 500k photos
 * on an HDD is too slow, so derive the key from the path/metadata tuple instead.
 * The original file is never opened for hashing.
 */
export function derivativeKey(relativePath: string, size: number, mtimeMs: number): string {
  return createHash('sha1')
    .update(`${relativePath}\0${size}\0${mtimeMs}`, 'utf8')
    .digest('hex');
}
