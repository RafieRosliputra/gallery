import { describe, expect, it } from 'vitest';
import { adminGate, albumPath, loginGate, safeNext } from './guards';

describe('adminGate', () => {
  it('allows only an observed session', () => {
    expect(adminGate('yes')).toBe('allow');
    expect(adminGate('no')).toBe('login');
    expect(adminGate('unknown')).toBe('login');
  });
});

describe('loginGate', () => {
  it('sends a signed-in admin to the timeline, everyone else to the form', () => {
    expect(loginGate('yes')).toBe('admin');
    expect(loginGate('no')).toBe('form');
    expect(loginGate('unknown')).toBe('form');
  });
});

describe('safeNext', () => {
  it('accepts same-app paths', () => {
    expect(safeNext('/s/admin/albums')).toBe('/s/admin/albums');
    expect(safeNext('/s')).toBe('/s');
  });

  it('rejects open redirects and foreign URLs', () => {
    expect(safeNext('https://evil.example')).toBe('/s/admin');
    expect(safeNext('//evil.example/s')).toBe('/s/admin');
    expect(safeNext('/sx/admin')).toBe('/s/admin');
    expect(safeNext('/admin')).toBe('/s/admin');
    expect(safeNext(null)).toBe('/s/admin');
  });
});

describe('albumPath', () => {
  it('stays inside the /s base', () => {
    expect(albumPath('mawar-konvo-2026')).toBe('/s/mawar-konvo-2026');
    expect(albumPath('a b')).toBe('/s/a%20b');
  });
});
