import exifr from 'exifr';
import sharp, { type Metadata } from 'sharp';
import './image-policy.js';

export interface PhotoMetadata {
  takenAt: Date;
  /** Dimensions after applying EXIF orientation. */
  width: number | null;
  height: number | null;
  orientation: number | null;
}

const EXIF_DATE_PATTERN = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/;

interface ExifPick {
  DateTimeOriginal?: string;
  OffsetTime?: string;
  OffsetTimeOriginal?: string;
}

/**
 * EXIF choice: exifr (MIT, pure JS, one dependency) instead of
 * - sharp.metadata(): returns only a raw EXIF buffer + orientation, still needs a parser;
 * - exiftool-vendored: most complete but ships/spawns Perl and costs ~100 MB in the image.
 */
export async function readPhotoMetadata(absolutePath: string, mtimeMs: number): Promise<PhotoMetadata> {
  let metadata: Metadata | null = null;
  try {
    metadata = await sharp(absolutePath).metadata();
  } catch {
    // The scanner records the failure and still keeps the row; thumbnails will retry.
  }

  const orientation = metadata?.orientation ?? null;
  const width = metadata?.autoOrient?.width ?? metadata?.width ?? null;
  const height = metadata?.autoOrient?.height ?? metadata?.height ?? null;

  let takenAt: Date | null = null;
  try {
    const exif = (await exifr.parse(absolutePath, {
      pick: ['DateTimeOriginal', 'OffsetTime', 'OffsetTimeOriginal'],
      reviveValues: false,
    })) as ExifPick | undefined;
    takenAt = parseExifDate(exif);
  } catch {
    // Missing/corrupt EXIF is not an error; fall back to the file mtime.
  }

  return {
    takenAt: takenAt ?? new Date(mtimeMs),
    width,
    height,
    orientation,
  };
}

/** Parse an EXIF wall-clock string plus optional UTC offset into an exact Date. */
export function parseExifDate(exif: ExifPick | undefined): Date | null {
  const raw = exif?.DateTimeOriginal?.trim();
  if (!raw) return null;
  const match = EXIF_DATE_PATTERN.exec(raw);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (!year || !month || !day || !hour || !minute || !second) return null;

  const offset = [exif?.OffsetTimeOriginal, exif?.OffsetTime].find(
    (value): value is string => typeof value === 'string' && OFFSET_PATTERN.test(value.trim()),
  );
  if (offset) {
    const parsed = new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}${offset.trim()}`,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // No offset: EXIF wall-clock time is local to the camera; keep it as server-local time.
  const local = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isNaN(local.getTime()) ? null : local;
}
