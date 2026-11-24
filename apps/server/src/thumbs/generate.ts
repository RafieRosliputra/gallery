import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { assertOutsideSource } from '../scan/paths.js';
import '../scan/image-policy.js';

export const GRID_HEIGHT = 300;
export const PREVIEW_LONG_EDGE = 1600;
export const WEBP_QUALITY = 80;

export interface DerivativeResult {
  directory: string;
  gridPath: string;
  previewPath: string;
  gridWidth: number;
  gridHeight: number;
  previewWidth: number;
  previewHeight: number;
  /** base64 thumbhash (SPEC stores it in `asset.thumbhash`). */
  thumbhash: string;
}

const DERIV_KEY_PATTERN = /^[a-f0-9]{40}$/;

export function derivativeDirectory(dataDir: string, derivKey: string): string {
  if (!DERIV_KEY_PATTERN.test(derivKey)) {
    throw new Error(`invalid derivative key: ${JSON.stringify(derivKey)}`);
  }
  return path.join(dataDir, 'thumbs', derivKey);
}

async function writeAtomically(target: string, write: (temporary: string) => Promise<void>): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await write(temporary);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function generateThumbhash(sourcePath: string): Promise<string> {
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .resize({ width: 100, height: 100, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
}

/**
 * Write DATA_DIR/thumbs/<derivKey>/{300,1600}.webp from the original.
 * Output is metadata-stripped by sharp and EXIF orientation is baked in.
 */
export async function generateDerivatives(options: {
  sourcePath: string;
  sourceRoot: string;
  dataDir: string;
  derivKey: string;
}): Promise<DerivativeResult> {
  const directory = derivativeDirectory(options.dataDir, options.derivKey);
  assertOutsideSource(options.sourceRoot, directory);
  await mkdir(directory, { recursive: true });

  const gridPath = path.join(directory, '300.webp');
  const previewPath = path.join(directory, '1600.webp');

  const grid: { width: number; height: number } = { width: 0, height: 0 };
  await writeAtomically(gridPath, async (temporary) => {
    const info = await sharp(options.sourcePath)
      .rotate()
      .resize({ height: GRID_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(temporary);
    grid.width = info.width;
    grid.height = info.height;
  });

  const preview: { width: number; height: number } = { width: 0, height: 0 };
  await writeAtomically(previewPath, async (temporary) => {
    const info = await sharp(options.sourcePath)
      .rotate()
      .resize({
        width: PREVIEW_LONG_EDGE,
        height: PREVIEW_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toFile(temporary);
    preview.width = info.width;
    preview.height = info.height;
  });

  return {
    directory,
    gridPath,
    previewPath,
    gridWidth: grid.width,
    gridHeight: grid.height,
    previewWidth: preview.width,
    previewHeight: preview.height,
    thumbhash: await generateThumbhash(options.sourcePath),
  };
}

export async function removeDerivativeDirectory(dataDir: string, derivKey: string): Promise<void> {
  await rm(derivativeDirectory(dataDir, derivKey), { recursive: true, force: true });
}

export async function assertWritableDataDir(sourceRoot: string, dataDir: string): Promise<void> {
  assertOutsideSource(sourceRoot, dataDir);
  await mkdir(dataDir, { recursive: true });
}
