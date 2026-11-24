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
  return resolved;
}

/** Fail if `candidate` would write under the read-only source root. */
export function assertOutsideSource(sourceRoot: string, candidate: string): void {
  const root = path.resolve(sourceRoot);
  const resolved = path.resolve(candidate);
  if (resolved === root || isInside(root, resolved)) {
    throw new Error(`refusing to write under SOURCE_ROOT: ${resolved}`);
  }
}

export { isInside };
