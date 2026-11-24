import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, loadR2Mode } from '../src/config.ts';
import { createWorkerUploader } from '../src/r2/uploader.ts';
import { derivativeDirectory } from '../src/thumbs/generate.ts';
import { writeWebp } from './helpers/fixtures.ts';

const KEY = 'e'.repeat(40);

describe('R2_MODE=worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUTs both derivatives to the Worker route with X-Upload-Secret', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'uploader-'));
    const directory = derivativeDirectory(dataDir, KEY);
    await writeWebp(path.join(directory, '300.webp'), 30, 20);
    await writeWebp(path.join(directory, '1600.webp'), 160, 100);

    const calls: { url: string; method: string; secret: string; size: number }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = init.body as Buffer;
      calls.push({
        url,
        method: init.method ?? '',
        secret: (init.headers as Record<string, string>)['X-Upload-Secret'] ?? '',
        size: body.byteLength,
      });
      return new Response('ok', { status: 201 });
    });

    try {
      const uploader = createWorkerUploader({ uploadUrl: 'https://gallery.test/s/_r2', secret: 'u-secret' });
      const keys = await uploader.upload(KEY, dataDir);
      expect(keys).toEqual([`t/${KEY}/300.webp`, `t/${KEY}/1600.webp`]);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        url: `https://gallery.test/s/_r2/t/${KEY}/300.webp`,
        method: 'PUT',
        secret: 'u-secret',
      });
      expect(calls[0]?.size).toBeGreaterThan(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('throws on a rejected upload and never echoes the secret', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'uploader-'));
    const directory = derivativeDirectory(dataDir, KEY);
    await writeWebp(path.join(directory, '300.webp'), 30, 20);
    await writeWebp(path.join(directory, '1600.webp'), 160, 100);
    vi.stubGlobal('fetch', async () => new Response('forbidden', { status: 403 }));

    try {
      const uploader = createWorkerUploader({ uploadUrl: 'https://gallery.test/s/_r2', secret: 'u-secret' });
      await expect(uploader.upload(KEY, dataDir)).rejects.toThrow(/403/);
      await expect(uploader.upload(KEY, dataDir)).rejects.not.toThrow(/u-secret/);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('requires UPLOAD_SECRET and rejects an unknown R2_MODE', () => {
    expect(() => loadR2Mode({ R2_MODE: 'worker' }, undefined)).toThrow(/UPLOAD_SECRET/);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y_test', R2_MODE: 'nope' })).toThrow(/R2_MODE/);
    const worker = loadR2Mode({ R2_MODE: 'worker', UPLOAD_SECRET: 's' }, undefined);
    expect(worker).toMatchObject({
      mode: 'worker',
      workerUpload: { uploadUrl: 'https://johorstudio.com/s/_r2', secret: 's' },
    });
  });
});
