import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison for shared secrets. Length differences return false. */
export function safeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
