import { mkdtemp, readFile, rm, stat, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { buildApp } from '../src/app.ts';
import { createSession } from '../src/auth/sessions.ts';
import { loadR2Config, type R2Config } from '../src/config.ts';
import { createBoss, enqueueThumbnails, ensureQueues } from '../src/jobs/boss.ts';
import { startWorker } from '../src/jobs/worker.ts';
import { createS3Uploader } from '../src/r2/uploader.ts';
import { derivativeKey } from '../src/scan/deriv-key.ts';
import { assertOutsideSource, resolveInside } from '../src/scan/paths.ts';
import { scanLibrary } from '../src/scan/scanner.ts';
import { derivativeDirectory } from '../src/thumbs/generate.ts';
import { createPool, resetAndMigrate } from './helpers/db.ts';
import {
  setMtime,
  writeJpeg,
  writeRejectedFixtures,
  writeText,
  writeWebp,
} from './helpers/fixtures.ts';

const FALLBACK_MTIME = Date.UTC(2021, 5, 1, 0, 0, 0);

interface AssetRow {
  id: string;
  path: string;
  camera: string | null;
  taken_at: Date | null;
  w: number | null;
  h: number | null;
  mime: string;
  deriv_key: string;
  thumbhash: string | null;
  thumb_ok: boolean;
  r2_ok: boolean;
  deleted_at: Date | null;
}

describe('ingest pipeline', () => {
  let pool: Pool;
  let sourceRoot: string;
  let dataDir: string;
  let outsideDir: string;
  let boss: PgBoss | null = null;
  let workerBoss: PgBoss | null = null;
  let r2: R2Config | undefined;
  let rejected: { gif: string; tiff: string; heic: string };

  beforeAll(async () => {
    await resetAndMigrate();
    pool = createPool(6);
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'gallery-source-'));
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'gallery-data-'));
    outsideDir = await mkdtemp(path.join(os.tmpdir(), 'gallery-outside-'));

    await writeJpeg(path.join(sourceRoot, 'Klien Demo/Cam 1/one.jpg'), 1200, 800, {
      orientation: 6,
      takenAt: '2024:05:01 10:00:00',
      offset: '+08:00',
    });
    await writeWebp(path.join(sourceRoot, 'Klien Demo/Cam 1/sub/two.webp'), 800, 600);
    await setMtime(path.join(sourceRoot, 'Klien Demo/Cam 1/sub/two.webp'), FALLBACK_MTIME);
    await writeJpeg(path.join(sourceRoot, 'Klien Demo/cam 2/three.jpeg'), 1600, 900);
    await writeJpeg(path.join(sourceRoot, 'root.jpg'), 400, 300);

    // Ignored: dotfile, @eaDir, Thumbs.db, non-image, wrong formats.
    await writeJpeg(path.join(sourceRoot, 'Klien Demo/Cam 1/.hidden.jpg'), 64, 64);
    await writeJpeg(path.join(sourceRoot, 'Klien Demo/Cam 1/@eaDir/ignored.jpg'), 64, 64);
    await writeText(path.join(sourceRoot, 'Klien Demo/Cam 1/notes.txt'), 'ignore me');
    await writeText(path.join(sourceRoot, 'Thumbs.db'), 'ignore me');
    rejected = await writeRejectedFixtures(path.join(sourceRoot, 'Klien Demo/Cam 1'));

    // Symlink escape: a link outside the root must not be followed.
    await writeJpeg(path.join(outsideDir, 'outside.jpg'), 64, 64);
    await symlink(outsideDir, path.join(sourceRoot, 'outside-link'));

    r2 = loadR2Config();
    if (r2) await ensureBucket(r2);

    boss = createBoss(process.env.DATABASE_URL ?? '');
    await boss.start();
    await ensureQueues(boss);

    const stats = await scanLibrary({
      pool,
      sourceRoot,
      dataDir,
      onAssetsChanged: async (ids) => {
        await enqueueThumbnails(boss as PgBoss, ids);
      },
    });
    expect(stats).toMatchObject({ scanned: 4, added: 4, changed: 0, unchanged: 0, deleted: 0, errors: 0 });
  });

  afterAll(async () => {
    await workerBoss?.stop({ graceful: false }).catch(() => undefined);
    await boss?.stop({ graceful: false }).catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(outsideDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('stores rows, camera tags, EXIF time and oriented dimensions', async () => {
    const { rows } = await pool.query<AssetRow>(
      'SELECT id, path, camera, taken_at, w, h, mime, deriv_key, thumbhash, thumb_ok, r2_ok, deleted_at FROM asset ORDER BY path',
    );
    expect(rows.map((row) => row.path)).toEqual([
      'Klien Demo/Cam 1/one.jpg',
      'Klien Demo/Cam 1/sub/two.webp',
      'Klien Demo/cam 2/three.jpeg',
      'root.jpg',
    ]);

    const one = rows[0] as AssetRow;
    expect(one.camera).toBe('Cam 1');
    expect(one.taken_at?.toISOString()).toBe('2024-05-01T02:00:00.000Z');
    expect([one.w, one.h]).toEqual([800, 1200]);
    expect(one.mime).toBe('image/jpeg');

    const two = rows[1] as AssetRow;
    expect(two.camera).toBe('Cam 1');
    expect(two.taken_at?.getTime()).toBe(FALLBACK_MTIME);
    expect(two.mime).toBe('image/webp');

    expect(rows[2]?.camera).toBe('Cam 2');
    expect(rows[3]?.camera).toBeNull();
    expect(rows.every((row) => row.deleted_at === null)).toBe(true);
  });

  it('upserts the folder tree with root as "."', async () => {
    const { rows } = await pool.query<{ path: string }>('SELECT path FROM folder ORDER BY path');
    expect(rows.map((row) => row.path)).toEqual([
      '.',
      'Klien Demo',
      'Klien Demo/Cam 1',
      'Klien Demo/Cam 1/sub',
      'Klien Demo/cam 2',
    ]);
  });

  it('skips unchanged files on a second pass', async () => {
    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(stats).toMatchObject({ scanned: 4, added: 0, changed: 0, unchanged: 4, deleted: 0 });
  });

  it('never follows symlinks or writes under SOURCE_ROOT', async () => {
    const paths: string[] = [];
    const { walkSourceFiles } = await import('../src/scan/files.ts');
    for await (const file of walkSourceFiles(sourceRoot)) paths.push(file.relativePath);
    expect(paths.some((value) => value.includes('outside-link'))).toBe(false);
    expect(paths.some((value) => value.includes('@eaDir'))).toBe(false);

    await expect(stat(path.join(sourceRoot, 'thumbs'))).rejects.toThrow();
    expect(() => resolveInside(sourceRoot, '../escape.jpg')).toThrow(/escapes root/);
    expect(() => resolveInside(sourceRoot, '/etc/passwd')).toThrow(/unsafe path/);
    expect(() => assertOutsideSource(sourceRoot, path.join(sourceRoot, 'x'))).toThrow(/SOURCE_ROOT/);
  });

  it('rejects GIF, TIFF and HEIF loaders through sharp.block()', async () => {
    for (const file of [rejected.gif, rejected.tiff, rejected.heic]) {
      await expect(sharp(file).metadata()).rejects.toThrow(/blocked|unsupported/i);
    }
  });

  it('requires an admin session for status and reports r2 state', async () => {
    const admin = await pool.query<{ id: string }>(
      "INSERT INTO admin (username, pw_hash) VALUES ('status-admin', 'unused') RETURNING id",
    );
    const session = await createSession(pool, admin.rows[0]?.id ?? '');
    const app = buildApp({ pool, version: 'test', r2Enabled: Boolean(r2) });
    try {
      const anonymous = await app.inject({ method: 'GET', url: '/s/api/admin/status' });
      expect(anonymous.statusCode).toBe(401);

      const response = await app.inject({
        method: 'GET',
        url: '/s/api/admin/status',
        headers: { cookie: `gallery_session=${session.token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ assets: 4, pendingThumbs: 4, errors24h: 0, r2Enabled: Boolean(r2) });
      expect(body.lastScanAt).toEqual(expect.any(String));
    } finally {
      await app.close();
    }
  });

  it('generates both WebP sizes, thumbhash and R2 objects', async () => {
    workerBoss = await startWorker({
      databaseUrl: process.env.DATABASE_URL ?? '',
      pool,
      sourceRoot,
      dataDir,
      thumbConcurrency: 2,
      ...(r2 ? { uploader: createS3Uploader(r2) } : {}),
    });

    await waitFor(async () => {
      const pending = await pool.query<{ count: string }>(
        'SELECT count(*) FROM asset WHERE deleted_at IS NULL AND thumb_ok = false',
      );
      return Number(pending.rows[0]?.count ?? 0) === 0;
    });

    const { rows } = await pool.query<AssetRow>(
      'SELECT id, path, camera, taken_at, w, h, mime, deriv_key, thumbhash, thumb_ok, r2_ok, deleted_at FROM asset ORDER BY path',
    );
    expect(rows).toHaveLength(4);

    for (const row of rows) {
      expect(row.thumb_ok).toBe(true);
      expect(row.thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/);
      const directory = derivativeDirectory(dataDir, row.deriv_key);
      const grid = await sharp(path.join(directory, '300.webp')).metadata();
      const preview = await sharp(path.join(directory, '1600.webp')).metadata();
      expect(grid.format).toBe('webp');
      expect(grid.height).toBe(300);
      expect(preview.format).toBe('webp');
      expect(Math.max(preview.width ?? 0, preview.height ?? 0)).toBeLessThanOrEqual(1600);

      if (row.path === 'Klien Demo/Cam 1/one.jpg') {
        // EXIF orientation 6: 1200x800 becomes 800x1200 before resizing.
        expect([grid.width, grid.height]).toEqual([200, 300]);
        expect([preview.width, preview.height]).toEqual([800, 1200]);
      }
      if (row.path === 'Klien Demo/cam 2/three.jpeg') {
        expect([preview.width, preview.height]).toEqual([1600, 900]);
      }
    }

    const one = rows[0] as AssetRow;
    const oneStat = await stat(path.join(sourceRoot, one.path));
    expect(one.deriv_key).toBe(
      derivativeKey(one.path, oneStat.size, Math.trunc(oneStat.mtimeMs)),
    );
  }, 60_000);

  it('uploads both derivatives to S3-compatible storage with immutable headers', async () => {
    if (!r2) {
      console.warn('r2: skipped (R2_* env not set; CI runs MinIO)');
      return;
    }

    await waitFor(async () => {
      const pending = await pool.query<{ count: string }>(
        'SELECT count(*) FROM asset WHERE deleted_at IS NULL AND thumb_ok = true AND r2_ok = false',
      );
      return Number(pending.rows[0]?.count ?? 0) === 0;
    });

    const client = s3Client(r2);
    const { rows } = await pool.query<AssetRow>(
      "SELECT id, path, camera, taken_at, w, h, mime, deriv_key, thumbhash, thumb_ok, r2_ok, deleted_at FROM asset WHERE path = 'root.jpg'",
    );
    const asset = rows[0] as AssetRow;
    expect(asset.r2_ok).toBe(true);

    for (const size of ['300', '1600'] as const) {
      const key = `t/${asset.deriv_key}/${size}.webp`;
      const head = await client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
      expect(head.ContentType).toBe('image/webp');
      expect(head.CacheControl).toBe('public, max-age=31536000, immutable');
      expect(head.ContentLength).toBeGreaterThan(0);

      const body = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
      const bytes = await body.Body?.transformToByteArray();
      const local = await readFile(path.join(derivativeDirectory(dataDir, asset.deriv_key), `${size}.webp`));
      expect(Buffer.from(bytes ?? [])).toEqual(local);
    }
  }, 60_000);

  it('marks a missing file deleted without removing the row', async () => {
    await unlink(path.join(sourceRoot, 'root.jpg'));
    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(stats.deleted).toBe(1);
    const { rows } = await pool.query<AssetRow>(
      "SELECT id, path, camera, taken_at, w, h, mime, deriv_key, thumbhash, thumb_ok, r2_ok, deleted_at FROM asset WHERE path = 'root.jpg'",
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it('re-hashes changed content and requeues it', async () => {
    const before = await assetByPath('Klien Demo/cam 2/three.jpeg');
    await setMtime(path.join(sourceRoot, 'Klien Demo/cam 2/three.jpeg'), Date.UTC(2022, 0, 2));
    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    expect(stats.changed).toBe(1);
    const after = await assetByPath('Klien Demo/cam 2/three.jpeg');
    expect(after.deriv_key).not.toBe(before.deriv_key);
    expect(after.thumb_ok).toBe(false);
  });

  async function assetByPath(relativePath: string): Promise<AssetRow> {
    const { rows } = await pool.query<AssetRow>(
      'SELECT id, path, camera, taken_at, w, h, mime, deriv_key, thumbhash, thumb_ok, r2_ok, deleted_at FROM asset WHERE path = $1',
      [relativePath],
    );
    const row = rows[0];
    if (!row) throw new Error(`missing asset ${relativePath}`);
    return row;
  }
});

function s3Client(r2: R2Config): S3Client {
  return new S3Client({
    endpoint: r2.endpoint,
    region: r2.region,
    forcePathStyle: true,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
}

async function ensureBucket(r2: R2Config): Promise<void> {
  const client = s3Client(r2);
  try {
    await client.send(new HeadBucketCommand({ Bucket: r2.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: r2.bucket }));
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for condition');
}
