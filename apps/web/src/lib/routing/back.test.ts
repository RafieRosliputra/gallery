import { describe, expect, it } from 'vitest';
import { clearOpenedFromClient, markOpenedFromClient, openedFromClient } from './back';

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

describe('album back link', () => {
  it('has no back target on a direct open', () => {
    expect(openedFromClient('konvo', new MemoryStorage())).toBeNull();
  });

  it('remembers the portal that opened the album in this tab', () => {
    const storage = new MemoryStorage();
    markOpenedFromClient('konvo', 'tadika-mawar', storage);
    expect(openedFromClient('konvo', storage)).toBe('tadika-mawar');
    expect(openedFromClient('sukan', storage)).toBeNull();
  });

  it('clears the marker', () => {
    const storage = new MemoryStorage();
    markOpenedFromClient('konvo', 'tadika-mawar', storage);
    clearOpenedFromClient('konvo', storage);
    expect(openedFromClient('konvo', storage)).toBeNull();
  });

  it('survives unavailable storage', () => {
    expect(() => markOpenedFromClient('konvo', 'tadika-mawar', null)).not.toThrow();
    expect(openedFromClient('konvo', null)).toBeNull();
  });
});
