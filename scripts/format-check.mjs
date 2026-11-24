#!/usr/bin/env node
// Format gate for the runtime image: real JPEG + WebP through the scanner and
// thumbnail job, then assert the two WebP derivatives and their dimensions.
// Exits non-zero on any mismatch so CI fails on a broken image.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { runMigrations } from '../apps/server/dist/migrate.js';
import { scanLibrary } from '../apps/server/dist/scan/scanner.js';
import { processThumbJob } from '../apps/server/dist/jobs/thumb.js';

const WIDTH = 1200;
const HEIGHT = 800;

function rawGradient(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      raw[offset] = Math.round((x / (width - 1)) * 255);
      raw[offset + 1] = Math.round((y / (height - 1)) * 255);
      raw[offset + 2] = 96;
    }
  }
  return raw;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for format-check');

  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'format-check-source-'));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'format-check-data-'));
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations({ databaseUrl });

    const input = rawGradient(WIDTH, HEIGHT);
    const raw = { raw: { width: WIDTH, height: HEIGHT, channels: 3 } };
    const jpg = path.join(sourceRoot, 'jpg', 'photo.jpg');
    const webp = path.join(sourceRoot, 'webp', 'photo.webp');
    await mkdir(path.dirname(jpg), { recursive: true });
    await mkdir(path.dirname(webp), { recursive: true });
    await writeFile(jpg, await sharp(input, raw).jpeg({ quality: 90 }).toBuffer());
    await writeFile(webp, await sharp(input, raw).webp({ quality: 80 }).toBuffer());

    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    if (stats.added !== 2 || stats.errors !== 0) {
      throw new Error(`scan expected 2 added/0 errors, got ${JSON.stringify(stats)}`);
    }

    const { rows } = await pool.query('SELECT id, path FROM asset ORDER BY path');
    for (const row of rows) {
      const result = await processThumbJob({
        pool,
        sourceRoot,
        dataDir,
        assetId: row.id,
      });
      if (!result) throw new Error(`no derivatives for ${row.path}`);

      const grid = await sharp(result.gridPath).metadata();
      const preview = await sharp(result.previewPath).metadata();
      const gridBytes = (await stat(result.gridPath)).size;
      const previewBytes = (await stat(result.previewPath)).size;

      if (grid.format !== 'webp' || preview.format !== 'webp') {
        throw new Error(`${row.path}: derivative format is not webp`);
      }
      if (grid.width !== 450 || grid.height !== 300) {
        throw new Error(`${row.path}: grid is ${grid.width}x${grid.height}, expected 450x300`);
      }
      if (preview.width !== 1200 || preview.height !== 800) {
        throw new Error(`${row.path}: preview is ${preview.width}x${preview.height}, expected 1200x800`);
      }
      const thumbhash = await readFile(result.gridPath);
      if (thumbhash.length === 0) throw new Error(`${row.path}: empty grid derivative`);
      if (!result.thumbhash || !/^[A-Za-z0-9+/]+=*$/.test(result.thumbhash)) {
        throw new Error(`${row.path}: thumbhash missing`);
      }
      console.log(
        `format-check: ${row.path} grid=450x300 ${gridBytes}B preview=1200x800 ${previewBytes}B ` +
          `thumbhash=${result.thumbhash.length}B`,
      );
    }

    console.log(
      `format-check: PASS jpg=${WIDTH}x${HEIGHT} webp=${WIDTH}x${HEIGHT} thumbs=${rows.length} ` +
        `sharp=${sharp.versions.sharp} vips=${sharp.versions.vips}`,
    );
  } finally {
    await pool.end().catch(() => undefined);
    await rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`format-check: FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
