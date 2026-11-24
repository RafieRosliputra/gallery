import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * OWASP 2025 minimum for Argon2id: 19 MiB, 2 iterations, 1 lane.
 * The hash is self-describing, so parameters can be raised later without
 * invalidating existing users.
 */
export const ARGON2_OPTIONS = {
  // Argon2id. The package exposes an ambient const enum, which
  // verbatimModuleSyntax cannot import as a value; the numeric value is stable.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1_024;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Hash a random throwaway value so unknown usernames cost the same as wrong passwords. */
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hash('not-a-real-password', ARGON2_OPTIONS);
  return dummyHash.then((value) => verifyPassword(value, password));
}

export function validateNewPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password.includes('\0')) return 'Password contains an invalid character.';
  return null;
}
