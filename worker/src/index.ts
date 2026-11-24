// johorstudio-gallery edge worker — route johorstudio.com/s and johorstudio.com/s/*
// - GET /s/t/<key>/<size>.webp → R2 (immutable), fallback to origin
// - PUT /s/_r2/<key>           → R2 write, requires X-Upload-Secret
// - everything else            → origin app on tnas via Workers VPC (Cloudflare Tunnel), never public
//
// Secrets (wrangler secret put, never committed): UPLOAD_SECRET, ORIGIN_SECRET.
// No public origin hostname exists; ORIGIN is a Workers VPC service binding.
export interface Env {
  ORIGIN: { fetch: typeof fetch };
  GALLERY: R2Bucket;
  UPLOAD_SECRET: string;
  ORIGIN_SECRET: string;
}

const ORIGIN_BASE = 'http://app:3000';
const enc = new TextEncoder();
const DERIVATIVE_KEY = /^t\/[a-f0-9]{40}\/(300|1600)\.webp$/;
const UPLOAD_PATH = '/s/_r2/';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const THUMB_PATH = '/s/t/';

function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

function text(message: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  });
}

async function toOrigin(req: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ORIGIN_SECRET) return text('Worker tidak dikonfigurasi.', 500);
  const headers = new Headers(req.headers);
  headers.delete('X-Upload-Secret');
  headers.set('X-Origin-Secret', env.ORIGIN_SECRET);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', 'https');
  const init: RequestInit = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
  const res = await env.ORIGIN.fetch(ORIGIN_BASE + url.pathname + url.search, init);
  const out = new Response(res.body, res);
  if (url.pathname.startsWith('/s/api/')) out.headers.set('Cache-Control', 'no-store');
  return out;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p.startsWith(UPLOAD_PATH)) {
      if (req.method !== 'PUT') return text('method not allowed', 405);
      const supplied = req.headers.get('X-Upload-Secret') ?? '';
      if (!env.UPLOAD_SECRET || !safeEqual(supplied, env.UPLOAD_SECRET)) {
        return text('forbidden', 403);
      }
      const key = p.slice(UPLOAD_PATH.length);
      if (!DERIVATIVE_KEY.test(key)) return text('bad key', 400);
      const declaredLength = Number(req.headers.get('content-length') ?? '0');
      if (declaredLength > MAX_UPLOAD_BYTES) return text('payload too large', 413);
      try {
        // R2 put needs a known length; derivatives are small, so buffer this one body.
        const body = await req.arrayBuffer();
        if (body.byteLength > MAX_UPLOAD_BYTES) return text('payload too large', 413);
        await env.GALLERY.put(key, body, {
          httpMetadata: {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });
      } catch {
        return text('storan tidak dapat ditulis', 502);
      }
      return text('ok', 201);
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith(THUMB_PATH)) {
      const key = 't/' + p.slice(THUMB_PATH.length);
      if (DERIVATIVE_KEY.test(key)) {
        try {
          const obj = await env.GALLERY.get(key);
          if (obj) {
            const headers = new Headers();
            obj.writeHttpMetadata(headers);
            headers.set('ETag', obj.httpEtag);
            headers.set('Content-Type', 'image/webp');
            headers.set('Cache-Control', 'public, max-age=31536000, immutable');
            return new Response(req.method === 'HEAD' ? null : obj.body, { headers });
          }
        } catch {
          // R2 unavailable: fall through to the origin copy instead of failing the page.
        }
      }
    }

    try {
      return await toOrigin(req, env, url);
    } catch {
      return text('Galeri tidak dapat dicapai buat masa ini.', 502);
    }
  },
};
