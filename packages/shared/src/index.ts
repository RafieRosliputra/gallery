/** Slug format shared by client and album links: `[a-z0-9-]{3,60}` (SPEC § Data model). */
export const SLUG_PATTERN = '^[a-z0-9-]{3,60}$';
export const SLUG_REGEX = new RegExp(SLUG_PATTERN);

/** Response body of `GET /s/api/health`. */
export interface HealthResponse {
  ok: boolean;
  version: string;
  db: 'up' | 'down';
}
