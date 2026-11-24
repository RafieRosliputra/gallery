export type SessionState = 'yes' | 'no' | 'unknown';

/** Fail closed: an admin route renders only when a session was observed. */
export function adminGate(session: SessionState): 'allow' | 'login' {
  return session === 'yes' ? 'allow' : 'login';
}

/** The login page bounces an already-signed-in admin to the timeline. */
export function loginGate(session: SessionState): 'admin' | 'form' {
  return session === 'yes' ? 'admin' : 'form';
}

/**
 * Only same-app targets are accepted for `?next=`; anything else falls back
 * to the admin timeline (no open redirects).
 */
export function safeNext(next: string | null, base = '/s'): string {
  const fallback = `${base}/admin`;
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next === base || next.startsWith(`${base}/`)) return next;
  return fallback;
}

/** Album URLs keep the base path and never point at another origin. */
export function albumPath(slug: string, base = '/s'): string {
  return `${base}/${encodeURIComponent(slug)}`;
}
