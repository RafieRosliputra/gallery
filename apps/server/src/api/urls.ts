export const DERIV_KEY_PATTERN = /^[a-f0-9]{40}$/;
export type DerivativeSize = '300' | '1600';

export function derivativeKeyIsValid(value: string): boolean {
  return DERIV_KEY_PATTERN.test(value);
}

/** `THUMB_BASE/<derivKey>/<size>.webp` (SPEC § Storage). */
export function thumbUrl(thumbBase: string, derivKey: string, size: DerivativeSize): string {
  return `${thumbBase}/${derivKey}/${size}.webp`;
}

export function originalUrl(assetId: string, albumSlug?: string): string {
  const base = `/s/api/o/${encodeURIComponent(assetId)}`;
  return albumSlug ? `${base}?album=${encodeURIComponent(albumSlug)}` : base;
}
