#!/usr/bin/env node
// HEIC gate for the runtime image: jpg -> HEIC (heif-enc/x265) -> sharp decode
// -> 300px webp. Exits non-zero on any mismatch so CI fails on a broken build.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_WIDTH = 1200;
const SOURCE_HEIGHT = 800;
const WEBP_WIDTH = 300;

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), 'heic-check-'));
  try {
    const source = path.join(dir, 'source.jpg');
    const heic = path.join(dir, 'source.heic');
    const webp = path.join(dir, 'thumb.webp');

    // Gradient, not a flat colour: exercises a real image through the encoder.
    const raw = Buffer.alloc(SOURCE_WIDTH * SOURCE_HEIGHT * 3);
    for (let y = 0; y < SOURCE_HEIGHT; y += 1) {
      for (let x = 0; x < SOURCE_WIDTH; x += 1) {
        const offset = (y * SOURCE_WIDTH + x) * 3;
        raw[offset] = Math.round((x / SOURCE_WIDTH) * 255);
        raw[offset + 1] = Math.round((y / SOURCE_HEIGHT) * 255);
        raw[offset + 2] = 128;
      }
    }

    await sharp(raw, { raw: { width: SOURCE_WIDTH, height: SOURCE_HEIGHT, channels: 3 } })
      .jpeg({ quality: 90 })
      .toFile(source);

    execFileSync('heif-enc', ['-q', '80', source, '-o', heic], { stdio: 'inherit' });

    const heicStat = await stat(heic);
    if (heicStat.size === 0) throw new Error('heif-enc produced an empty file');

    const decoded = await sharp(heic).metadata();
    if (decoded.format !== 'heif') throw new Error(`decoded format is ${decoded.format}, expected heif`);
    if (decoded.compression !== 'hevc') {
      throw new Error(`decoded compression is ${decoded.compression}, expected hevc`);
    }
    if (decoded.width !== SOURCE_WIDTH || decoded.height !== SOURCE_HEIGHT) {
      throw new Error(
        `decoded ${decoded.width}x${decoded.height}, expected ${SOURCE_WIDTH}x${SOURCE_HEIGHT}`,
      );
    }

    const thumb = await sharp(heic).resize({ width: WEBP_WIDTH }).webp({ quality: 80 }).toFile(webp);
    const thumbMeta = await sharp(webp).metadata();
    if (thumbMeta.format !== 'webp') throw new Error(`thumb format is ${thumbMeta.format}, expected webp`);
    if (thumbMeta.width !== WEBP_WIDTH) {
      throw new Error(`thumb width is ${thumbMeta.width}, expected ${WEBP_WIDTH}`);
    }
    if (thumb.width !== WEBP_WIDTH) throw new Error(`webp output width ${thumb.width} != ${WEBP_WIDTH}`);
    if (thumb.height !== Math.round((SOURCE_HEIGHT * WEBP_WIDTH) / SOURCE_WIDTH)) {
      throw new Error(`webp output height ${thumb.height} does not match aspect ratio`);
    }

    console.log(
      `heic-check: PASS source=${SOURCE_WIDTH}x${SOURCE_HEIGHT} heic=heif/hevc ${heicStat.size}B ` +
        `decode=${decoded.width}x${decoded.height} webp=${thumbMeta.width}x${thumbMeta.height} ${thumb.size}B ` +
        `sharp=${sharp.versions.sharp} vips=${sharp.versions.vips}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`heic-check: FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
