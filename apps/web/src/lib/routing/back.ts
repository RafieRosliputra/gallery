const PREFIX = 'gallery:back:';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Remembers that an album was opened from its client's portal **in this tab**
 * (SPEC: direct album opens have no back link). Stored in sessionStorage, so
 * a new tab or a copied URL starts clean.
 */
export function markOpenedFromClient(
  albumSlug: string,
  clientSlug: string,
  storage: StorageLike | null = defaultStorage()
): void {
  try {
    storage?.setItem(`${PREFIX}${albumSlug}`, clientSlug);
  } catch {
    // Session storage can be unavailable; the album simply has no back link.
  }
}

export function openedFromClient(
  albumSlug: string,
  storage: StorageLike | null = defaultStorage()
): string | null {
  try {
    const value = storage?.getItem(`${PREFIX}${albumSlug}`);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function clearOpenedFromClient(
  albumSlug: string,
  storage: StorageLike | null = defaultStorage()
): void {
  try {
    storage?.removeItem?.(`${PREFIX}${albumSlug}`);
  } catch {
    // Nothing to do.
  }
}
