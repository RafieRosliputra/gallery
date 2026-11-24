import { describe, expect, it } from 'vitest';
import { FavouritesStore, favouritesKey, getFavourites, resetFavouritesCache } from './favourites';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('FavouritesStore', () => {
  it('toggles and reports the badge count', () => {
    const store = new FavouritesStore('konvo', new MemoryStorage());
    expect(store.count()).toBe(0);
    expect(store.toggle('a1')).toBe(true);
    expect(store.toggle('a2')).toBe(true);
    expect(store.count()).toBe(2);
    expect(store.has('a1')).toBe(true);
    expect(store.toggle('a1')).toBe(false);
    expect(store.snapshot()).toEqual(['a2']);
  });

  it('persists under a per-album key and survives a reload', () => {
    const storage = new MemoryStorage();
    const first = new FavouritesStore('konvo', storage);
    first.toggle('a1');
    first.toggle('a2');
    expect(JSON.parse(storage.getItem(favouritesKey('konvo')) ?? '[]')).toEqual(['a1', 'a2']);

    const second = new FavouritesStore('konvo', storage);
    expect(second.snapshot()).toEqual(['a1', 'a2']);
    expect(new FavouritesStore('sukan', storage).snapshot()).toEqual([]);
  });

  it('clears only its own album list', () => {
    const storage = new MemoryStorage();
    const konvo = new FavouritesStore('konvo', storage);
    const sukan = new FavouritesStore('sukan', storage);
    konvo.toggle('a1');
    sukan.toggle('b1');
    konvo.clear();
    expect(konvo.snapshot()).toEqual([]);
    expect(sukan.snapshot()).toEqual(['b1']);
  });

  it('ignores corrupted storage instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(favouritesKey('konvo'), '{not json');
    expect(new FavouritesStore('konvo', storage).snapshot()).toEqual([]);
  });

  it('dedupes persisted ids and drops non-strings', () => {
    const storage = new MemoryStorage();
    storage.setItem(favouritesKey('konvo'), JSON.stringify(['a', 'a', 3, null, 'b']));
    expect(new FavouritesStore('konvo', storage).snapshot()).toEqual(['a', 'b']);
  });

  it('shares one cached store per album', () => {
    resetFavouritesCache();
    expect(getFavourites('konvo')).toBe(getFavourites('konvo'));
    expect(getFavourites('konvo')).not.toBe(getFavourites('sukan'));
  });
});
