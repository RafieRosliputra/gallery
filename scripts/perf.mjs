#!/usr/bin/env node
// Report-only performance smoke: never fails on a threshold (AGENTS §6).
// scan N generated files -> files/s, then generate derivatives for M photos.
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { runMigrations } from '../apps/server/dist/migrate.js';
import { scanLibrary } from '../apps/server/dist/scan/scanner.js';
import { derivativeKey } from '../apps/server/dist/scan/deriv-key.js';
import { generateDerivatives } from '../apps/server/dist/thumbs/generate.js';

const SCAN_FILES = 2000;
const THUMB_PHOTOS = 20;

function gradient(width, height) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      raw[offset] = Math.round((x / (width - 1)) * 255);
      raw[offset + 1] = Math.round((y / (height - 1)) * 255);
      raw[offset + 2] = 128;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for perf');

  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'perf-source-'));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'perf-data-'));
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations({ databaseUrl });

    const small = await gradient(96, 96).jpeg({ quality: 80 }).toBuffer();
    for (let index = 0; index < SCAN_FILES; index += 1) {
      const directory = path.join(sourceRoot, `folder-${String(index % 20).padStart(2, '0')}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `photo-${String(index).padStart(4, '0')}.jpg`), small);
    }

    const scanStarted = performance.now();
    const stats = await scanLibrary({ pool, sourceRoot, dataDir });
    const scanMs = performance.now() - scanStarted;
    if (stats.added !== SCAN_FILES) throw new Error(`expected ${SCAN_FILES} rows, got ${stats.added}`);
    console.log(
      `perf: scan ${SCAN_FILES} files in ${(scanMs / 1000).toFixed(2)}s = ` +
        `${Math.round((SCAN_FILES / scanMs) * 1000)} files/s`,
    );

    const large = await gradient(1600, 1200).jpeg({ quality: 90 }).toBuffer();
    const thumbRoot = path.join(sourceRoot, 'thumbs-bench');
    await mkdir(thumbRoot, { recursive: true });
    const thumbFiles = [];
    for (let index = 0; index < THUMB_PHOTOS; index += 1) {
      const file = path.join(thumbRoot, `large-${index}.jpg`);
      await writeFile(file, large);
      thumbFiles.push(file);
    }

    const thumbStarted = performance.now();
    for (const file of thumbFiles) {
      const fileStats = await stat(file);
      await generateDerivatives({
        sourcePath: file,
        sourceRoot,
        dataDir,
        derivKey: derivativeKey(path.relative(sourceRoot, file).split(path.sep).join('/'), fileStats.size, fileStats.mtimeMs),
      });
    }
    const thumbMs = performance.now() - thumbStarted;
    console.log(
      `perf: thumb ${THUMB_PHOTOS} photos in ${(thumbMs / 1000).toFixed(2)}s = ` +
        `${Math.round(thumbMs / THUMB_PHOTOS)} ms/photo (300+1600 webp + thumbhash)`,
    );
    console.log(`perf: sharp=${sharp.versions.sharp} vips=${sharp.versions.vips}`);
  } finally {
    await pool.end().catch(() => undefined);
    await rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`perf: FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
