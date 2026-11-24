import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseSourceMounts } from '../src/config.ts';
import { walkSourceFiles } from '../src/scan/files.ts';
import { assertOutsideSource, registerSourceMounts, resolveInside } from '../src/scan/paths.ts';

describe('source mounts (SOURCE_MOUNTS)', () => {
  let base = '';
  let main = '';
  let extra = '';

  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'gallery-mounts-'));
    main = path.join(base, 'studio');
    extra = path.join(base, 'ssd');
    await mkdir(path.join(main, 'Event A'), { recursive: true });
    await mkdir(path.join(main, 'client-1month'), { recursive: true });
    await mkdir(path.join(extra, 'Event B', 'Cam 2'), { recursive: true });
    await writeFile(path.join(main, 'Event A', 'a.jpg'), 'x');
    await writeFile(path.join(main, 'client-1month', 'shadowed.jpg'), 'x');
    await writeFile(path.join(extra, 'Event B', 'Cam 2', 'b.jpg'), 'x');
    registerSourceMounts(main, [{ name: 'client-1month', root: extra }]);
  });

  afterAll(async () => {
    registerSourceMounts(main, []);
    await rm(base, { recursive: true, force: true });
  });

  it('parses name=/path lists and rejects bad entries', () => {
    expect(parseSourceMounts('client-1month=/data/mounts/c1, b=/x')).toEqual([
      { name: 'client-1month', root: '/data/mounts/c1' },
      { name: 'b', root: '/x' },
    ]);
    expect(parseSourceMounts(undefined)).toEqual([]);
    expect(() => parseSourceMounts('a/b=/x')).toThrow(/SOURCE_MOUNTS/);
    expect(() => parseSourceMounts('a=relative')).toThrow(/SOURCE_MOUNTS/);
    expect(() => parseSourceMounts('..=/x')).toThrow(/SOURCE_MOUNTS/);
  });

  it('walks a mount as a top-level folder and shadows a same-named real folder', async () => {
    const files = [];
    for await (const file of walkSourceFiles(main)) files.push(file);
    expect(files.map((file) => file.relativePath)).toEqual(['Event A/a.jpg', 'client-1month/Event B/Cam 2/b.jpg']);
    const mounted = files[1];
    expect(mounted?.absolutePath).toBe(path.join(extra, 'Event B', 'Cam 2', 'b.jpg'));
    expect(mounted?.camera).toBe('Cam 2');
  });

  it('resolves mounted DB paths into the mount and keeps escapes blocked', () => {
    expect(resolveInside(main, 'client-1month/Event B/Cam 2/b.jpg')).toBe(path.join(extra, 'Event B', 'Cam 2', 'b.jpg'));
    expect(resolveInside(main, 'Event A/a.jpg')).toBe(path.join(main, 'Event A', 'a.jpg'));
    expect(() => resolveInside(main, 'client-1month/../../etc/passwd')).toThrow(/escapes root/);
    expect(() => assertOutsideSource(main, path.join(extra, 'thumbs'))).toThrow(/source mount/);
  });
});
