import { get, writable, type Readable, type Writable } from 'svelte/store';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const PREFIX = 'gallery:fav:';

export function favouritesKey(albumSlug: string): string {
  return `${PREFIX}${albumSlug}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

/**
 * Favourites are browser-local only (SPEC § Decisions): one key per album,
 * never sent to the server except as explicit ZIP ids.
 */
export class FavouritesStore implements Readable<string[]> {
  readonly albumSlug: string;
  readonly #storage: StorageLike | null;
  readonly #store: Writable<string[]>;

  constructor(albumSlug: string, storage: StorageLike | null = defaultStorage()) {
    this.albumSlug = albumSlug;
    this.#storage = storage;
    let initial: string[] = [];
    try {
      initial = parse(storage?.getItem(favouritesKey(albumSlug)) ?? null);
    } catch {
      initial = [];
    }
    this.#store = writable(initial);
  }

  subscribe(run: (value: string[]) => void, invalidate?: (value?: string[]) => void) {
    return this.#store.subscribe(run, invalidate);
  }

  snapshot(): string[] {
    return get(this.#store);
  }

  has(id: string): boolean {
    return this.snapshot().includes(id);
  }

  count(): number {
    return this.snapshot().length;
  }

  toggle(id: string): boolean {
    const current = this.snapshot();
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    this.#commit(next);
    return next.includes(id);
  }

  clear(): void {
    this.#commit([]);
  }

  #commit(ids: string[]): void {
    this.#store.set(ids);
    try {
      this.#storage?.setItem(favouritesKey(this.albumSlug), JSON.stringify(ids));
    } catch {
      // Storage can be unavailable (private mode, quota); the in-memory list
      // still works for this session.
    }
  }
}

const cache = new Map<string, FavouritesStore>();

/** Shared instance per album so header badge and grid stay in sync. */
export function getFavourites(albumSlug: string): FavouritesStore {
  let store = cache.get(albumSlug);
  if (!store) {
    store = new FavouritesStore(albumSlug);
    cache.set(albumSlug, store);
  }
  return store;
}

/** Test helper: drops cached instances so a fresh store re-reads storage. */
export function resetFavouritesCache(): void {
  cache.clear();
}
