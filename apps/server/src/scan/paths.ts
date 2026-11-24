import path from 'node:path';

/** POSIX relative path used in the DB, independent of where the source is mounted. */
export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Extra source folders mounted as virtual top-level folders of SOURCE_ROOT
 * (SOURCE_MOUNTS, e.g. `client-1month=/data/mounts/client-1month`). A DB path
 * `client-1month/x/y.jpg` lives at `<mount root>/x/y.jpg`. A real directory of
 * the same name directly under SOURCE_ROOT is shadowed by the mount.
 */
export interface SourceMount {
  name: string;
  root: string;
}

let registered: { root: string; mounts: SourceMount[] } | null = null;

export function registerSourceMounts(root: string, mounts: readonly SourceMount[]): void {
  registered = {
    root: path.resolve(root),
    mounts: mounts.map((mount) => ({ name: mount.name, root: path.resolve(mount.root) })),
  };
}

/** Mounts that belong to `root` (none unless `root` is the registered SOURCE_ROOT). */
export function sourceMountsFor(root: string): SourceMount[] {
  return registered && path.resolve(root) === registered.root ? registered.mounts : [];
}

/**
 * Resolve a DB/relative path inside a root. Rejects absolute paths, `..` escapes
 * and NUL bytes (AGENTS §5 path rule, SPEC § Security).
 */
export function resolveInside(root: string, relativePath: string): string {
  if (relativePath.length === 0 || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error(`refusing unsafe path: ${JSON.stringify(relativePath)}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes root: ${JSON.stringify(relativePath)}`);
  }
  const [first, ...rest] = relative.split(path.sep);
  const mount = sourceMountsFor(resolvedRoot).find((candidate) => candidate.name === first);
  if (mount) {
    if (rest.length === 0) return mount.root;
    return resolveInside(mount.root, rest.join(path.sep));
  }
  return resolved;
}

/** Fail if `candidate` would write under the read-only source root. */
export function assertOutsideSource(sourceRoot: string, candidate: string): void {
  const root = path.resolve(sourceRoot);
  const resolved = path.resolve(candidate);
  if (resolved === root || isInside(root, resolved)) {
    throw new Error(`refusing to write under SOURCE_ROOT: ${resolved}`);
  }
  for (const mount of sourceMountsFor(root)) {
    if (resolved === mount.root || isInside(mount.root, resolved)) {
      throw new Error(`refusing to write under source mount ${mount.name}: ${resolved}`);
    }
  }
}

export { isInside };
