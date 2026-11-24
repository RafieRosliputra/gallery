import { existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { NOT_FOUND_MESSAGE, sendError } from '../api/http.js';
import { resolveInside } from '../scan/paths.js';

export interface WebStaticDeps {
  /** SvelteKit `build/` directory (config WEB_DIR). */
  root: string;
}

const INDEX = 'index.html';
const STATIC_PREFIX = '/s/';
const EXCLUDED_PREFIXES = ['/s/api', '/s/t', '/s/_r2'];

const HTML_CACHE = 'no-cache';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const ASSET_CACHE = 'public, max-age=3600';

function isExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function decodePathname(raw: string | undefined): string {
  const pathname = raw?.split('?')[0] ?? '/';
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function securityHeaders(reply: FastifyReply, csp: string | null): FastifyReply {
  const secured = reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Frame-Options', 'DENY');
  return csp ? secured.header('Content-Security-Policy', csp) : secured;
}

/** The SvelteKit build carries its own strict CSP (hash mode) as a meta tag. */
function readCsp(indexFile: string): string | null {
  const html = readFileSync(indexFile, 'utf8');
  const match = /<meta http-equiv="content-security-policy" content="([^"]+)">/i.exec(html);
  return match?.[1] ?? null;
}

async function sendWebFile(
  reply: FastifyReply,
  root: string,
  relative: string,
  cacheControl: string,
): Promise<boolean> {
  let file: string;
  try {
    file = resolveInside(root, relative);
  } catch {
    return false;
  }
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  void reply.header('Cache-Control', cacheControl).header('X-Content-Type-Options', 'nosniff');
  void reply.sendFile(relative);
  return true;
}

function sendIndex(reply: FastifyReply, csp: string | null): FastifyReply {
  void securityHeaders(reply, csp).header('Cache-Control', HTML_CACHE);
  return reply.sendFile(INDEX);
}

/**
 * Serve the SvelteKit SPA at `/s` (apps/web/README.md build contract):
 * immutable cache for hashed `_app/immutable` files, `no-cache` for
 * `index.html`, and the SPA fallback for every other GET under `/s`.
 *
 * `/s/api/*`, `/s/t/*` and `/s/_r2/*` never fall back: an unknown path there is
 * a real 404, not an HTML page.
 */
export function registerWebStatic(app: FastifyInstance, deps: WebStaticDeps): void {
  const root = path.resolve(deps.root);
  const indexFile = path.join(root, INDEX);
  if (!existsSync(indexFile)) {
    app.log.warn({ webDir: root }, 'web build not found; /s serves API only');
    return;
  }

  const csp = readCsp(indexFile);
  if (!csp) app.log.warn({ webDir: root }, 'web index.html has no CSP meta tag');

  void app.register(fastifyStatic, {
    root,
    prefix: STATIC_PREFIX,
    serve: false,
    cacheControl: false,
  });

  const index = async (_request: unknown, reply: FastifyReply) => sendIndex(reply, csp);
  app.get('/s', index);
  app.get('/s/', index);

  app.get('/s/*', async (request, reply) => {
    const pathname = decodePathname(request.raw.url);
    if (isExcluded(pathname)) return sendError(reply, 404, 'not_found', NOT_FOUND_MESSAGE);

    const wildcard = (request.params as Record<string, string | undefined>)['*'] ?? '';
    const relative = wildcard.replace(/^\/+/, '');
    if (relative) {
      const cache = relative.startsWith('_app/immutable/') ? IMMUTABLE_CACHE : ASSET_CACHE;
      if (await sendWebFile(reply, root, relative, cache)) return reply;
    }
    return sendIndex(reply, csp);
  });
}
