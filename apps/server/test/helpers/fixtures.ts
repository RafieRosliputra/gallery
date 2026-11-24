import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export interface FixtureOptions {
  orientation?: number;
  takenAt?: string;
  offset?: string;
}

/**
 * Generated fixtures only (AGENTS §2.7: no real client photos). A small
 * gradient makes the encoder do real work without bloating the test run.
 */
export async function writeJpeg(file: string, width: number, height: number, options: FixtureOptions = {}): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  let pipeline = sharp(gradient(width, height), { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 });
  if (options.orientation) pipeline = pipeline.withMetadata({ orientation: options.orientation });
  if (options.takenAt) {
    pipeline = pipeline.withExifMerge({
      IFD2: {
        DateTimeOriginal: options.takenAt,
        ...(options.offset ? { OffsetTimeOriginal: options.offset } : {}),
      },
    });
  }
  await pipeline.toFile(file);
}

export async function writeWebp(file: string, width: number, height: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(gradient(width, height), { raw: { width, height, channels: 3 } })
    .webp({ quality: 80 })
    .toFile(file);
}

function gradient(width: number, height: number): Buffer {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      raw[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      raw[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      raw[offset + 2] = 96;
    }
  }
  return raw;
}

/** Formats the scanner must ignore; written with sharp so they are real images. */
export async function writeRejectedFixtures(directory: string): Promise<{ gif: string; tiff: string; heic: string }> {
  await mkdir(directory, { recursive: true });
  const gif = path.join(directory, 'animation.gif');
  const tiff = path.join(directory, 'scan.tiff');
  const heic = path.join(directory, 'phone.heic');
  const raw = { raw: { width: 64, height: 64, channels: 3 as const } };
  await sharp(gradient(64, 64), raw).gif().toFile(gif);
  await sharp(gradient(64, 64), raw).tiff().toFile(tiff);
  // sharp's prebuilt can write AVIF but not HEVC; an AVIF payload under a .heic
  // name still selects libvips' HEIF loader, which the block list must reject.
  await sharp(gradient(64, 64), raw).heif({ compression: 'av1' }).toFile(heic);
  return { gif, tiff, heic };
}

export async function setMtime(file: string, epochMs: number): Promise<void> {
  await utimes(file, epochMs / 1000, epochMs / 1000);
}

export async function writeText(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, 'utf8');
}
