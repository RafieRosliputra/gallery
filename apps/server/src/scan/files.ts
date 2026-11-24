import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { toPosixPath } from './paths.js';
import { DEFAULT_SCAN_EXCLUDE } from './excludes.js';

export const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.webp']);

const IGNORED_DIRECTORIES = new Set(['@eadir']);
const IGNORED_FILES = new Set(['thumbs.db']);

export interface SourceFile {
  /** POSIX path relative to SOURCE_ROOT, e.g. `Klien Demo/Cam 1/a.jpg`. */
  relativePath: string;
  absolutePath: string;
  size: number;
  mtimeMs: number;
  /** Normalized `Cam N` of the nearest matching ancestor directory, else null. */
  camera: string | null;
}

export function imageMimeType(filename: string): 'image/jpeg' | 'image/webp' | null {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return null;
}

export function isAcceptableImageName(filename: string): boolean {
  return !filename.startsWith('.') && !IGNORED_FILES.has(filename.toLowerCase()) && imageMimeType(filename) !== null;
}

export function isIgnoredDirectoryName(name: string, excluded?: ReadonlySet<string>): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || IGNORED_DIRECTORIES.has(lower) || (excluded?.has(lower) ?? false);
}

const CAMERA_PATTERN = /^cam\s*(\d+)$/i;

export function cameraFromDirectoryName(name: string): string | null {
  const match = CAMERA_PATTERN.exec(name.trim());
  if (!match) return null;
  return `Cam ${Number(match[1])}`;
}

export function isCameraDirectory(name: string): boolean {
  return CAMERA_PATTERN.test(name.trim());
}

export interface WalkOptions {
  /** Directory names skipped at any depth. Defaults to DEFAULT_SCAN_EXCLUDE. */
  excludeDirectories?: readonly string[];
  /** Called for unreadable directories/files; walking continues. */
  onError?: (absolutePath: string, error: unknown) => void;
}

/**
 * Depth-first walk of the read-only source root. Symlinks are never followed,
 * dotfiles/`@eaDir`/`Thumbs.db` are skipped, and only .jpg/.jpeg/.webp are yielded.
 */
export async function* walkSourceFiles(root: string, options: WalkOptions = {}): AsyncGenerator<SourceFile> {
  const excluded = new Set(
    (options.excludeDirectories ?? DEFAULT_SCAN_EXCLUDE).map((name) => name.trim().toLowerCase()),
  );
  yield* walkDirectory(root, '', null, { ...options, excluded });
}

interface ResolvedWalkOptions extends WalkOptions {
  excluded: ReadonlySet<string>;
}

async function* walkDirectory(
  root: string,
  relativeDirectory: string,
  inheritedCamera: string | null,
  options: ResolvedWalkOptions,
): AsyncGenerator<SourceFile> {
  const absoluteDirectory = relativeDirectory === '' ? root : path.join(root, relativeDirectory);
  let directory;
  try {
    directory = await opendir(absoluteDirectory);
  } catch (error) {
    options.onError?.(absoluteDirectory, error);
    return;
  }

  const entries = [];
  try {
    for await (const entry of directory) entries.push(entry);
  } catch (error) {
    options.onError?.(absoluteDirectory, error);
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (isIgnoredDirectoryName(entry.name, options.excluded)) continue;
      const childRelative = relativeDirectory === '' ? entry.name : path.join(relativeDirectory, entry.name);
      const camera = cameraFromDirectoryName(entry.name) ?? inheritedCamera;
      yield* walkDirectory(root, childRelative, camera, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isAcceptableImageName(entry.name)) continue;

    const childRelative = relativeDirectory === '' ? entry.name : path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(root, childRelative);
    try {
      const stats = await lstat(absolutePath);
      if (!stats.isFile()) continue;
      yield {
        relativePath: toPosixPath(childRelative),
        absolutePath,
        size: stats.size,
        mtimeMs: Math.trunc(stats.mtimeMs),
        camera: inheritedCamera,
      };
    } catch (error) {
      options.onError?.(absolutePath, error);
    }
  }
}
