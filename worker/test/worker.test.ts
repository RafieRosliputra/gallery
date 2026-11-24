import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import worker from '../src/index.ts';

const KEY = 'a'.repeat(40);
const UPLOAD_SECRET = 'upload-secret-for-tests';
const ORIGIN_SECRET = 'origin-secret-for-tests';

interface OriginCall {
  url: string;
  method: string;
  secret: string;
  forwardedHost: string;
  forwardedProto: string;
  body: string;
}

let mf: Miniflare;
let originCalls: OriginCall[];
let originHandler: (request: Request) => Response | Promise<Response>;

beforeEach(async () => {
  originCalls = [];
  originHandler = () => new Response('origin', { status: 200 });

  mf = new Miniflare({
    modules: true,
    scriptPath: path.resolve('dist/index.mjs'),
    // Stable miniflare's bundled workerd predates the Worker's deploy date.
    // The handler uses no newer runtime feature, so the test date is capped here.
    compatibilityDate: '2026-08-06',
    bindings: {
      UPLOAD_SECRET,
      ORIGIN_SECRET,
    },
    r2Buckets: ['GALLERY'],
    serviceBindings: {
      ORIGIN: async (request: Request) => {
        originCalls.push({
          url: new URL(request.url).pathname + new URL(request.url).search,
          method: request.method,
          secret: request.headers.get('x-origin-secret') ?? '',
          forwardedHost: request.headers.get('x-forwarded-host') ?? '',
          forwardedProto: request.headers.get('x-forwarded-proto') ?? '',
          body: request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text(),
        });
        return originHandler(request);
      },
    },
  });
  await mf.ready;
});

afterEach(async () => {
  await mf.dispose();
});

type DispatchInit = Parameters<Miniflare['dispatchFetch']>[1];

async function dispatch(url: string, init?: DispatchInit) {
  return mf.dispatchFetch(url, init);
}

describe('worker proxy', () => {
  it('proxies app routes to ORIGIN with the secret and forwarded headers', async () => {
    originHandler = (request) =>
      new Response(JSON.stringify({ seen: new URL(request.url).pathname }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
      });

    const response = await dispatch('https://johorstudio.com/s/api/resolve/klien-demo?x=1', {
      headers: { 'x-origin-secret': 'client-supplied-spoof' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seen: '/s/api/resolve/klien-demo' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(originCalls).toHaveLength(1);
    expect(originCalls[0]).toMatchObject({
      url: '/s/api/resolve/klien-demo?x=1',
      method: 'GET',
      secret: ORIGIN_SECRET,
      forwardedHost: 'johorstudio.com',
      forwardedProto: 'https',
    });
  });

  it('proxies POST bodies unchanged', async () => {
    originHandler = () => new Response('zipped', { status: 200 });
    const body = JSON.stringify({ albumSlug: 'album-a', ids: ['1', '2'] });
    const response = await dispatch('https://johorstudio.com/s/api/zip', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(200);
    expect(originCalls[0]?.method).toBe('POST');
    expect(originCalls[0]?.body).toBe(body);
  });

  it('proxies the bare /s route', async () => {
    const response = await dispatch('https://johorstudio.com/s');
    expect(response.status).toBe(200);
    expect(originCalls[0]?.url).toBe('/s');
  });

  it('passes an origin 500 through unchanged', async () => {
    originHandler = () => new Response('origin failed', { status: 500 });
    const response = await dispatch('https://johorstudio.com/s/portal');
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('origin failed');
  });
});

describe('worker thumbnails', () => {
  it('serves derivatives from R2 without touching the origin', async () => {
    const bucket = await mf.getR2Bucket('GALLERY');
    await bucket.put(`t/${KEY}/300.webp`, 'r2-grid', {
      httpMetadata: { contentType: 'image/webp' },
    });

    const response = await dispatch(`https://johorstudio.com/s/t/${KEY}/300.webp`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('r2-grid');
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(originCalls).toHaveLength(0);
  });

  it('falls back to the origin on an R2 miss', async () => {
    originHandler = () => new Response('local-fallback', { status: 200 });
    const response = await dispatch(`https://johorstudio.com/s/t/${KEY}/1600.webp`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('local-fallback');
    expect(originCalls[0]?.url).toBe(`/s/t/${KEY}/1600.webp`);
  });
});

describe('worker R2 upload', () => {
  it('rejects missing and wrong X-Upload-Secret', async () => {
    const missing = await dispatch(`https://johorstudio.com/s/_r2/t/${KEY}/300.webp`, { method: 'PUT', body: 'x' });
    expect(missing.status).toBe(403);
    const wrong = await dispatch(`https://johorstudio.com/s/_r2/t/${KEY}/300.webp`, {
      method: 'PUT',
      body: 'x',
      headers: { 'x-upload-secret': 'wrong' },
    });
    expect(wrong.status).toBe(403);
    expect(originCalls).toHaveLength(0);
  });

  it('rejects bad keys and non-PUT methods', async () => {
    const badKey = await dispatch('https://johorstudio.com/s/_r2/not-a-key', {
      method: 'PUT',
      body: 'x',
      headers: { 'x-upload-secret': UPLOAD_SECRET },
    });
    expect(badKey.status).toBe(400);

    const get = await dispatch(`https://johorstudio.com/s/_r2/t/${KEY}/300.webp`, {
      method: 'GET',
      headers: { 'x-upload-secret': UPLOAD_SECRET },
    });
    expect(get.status).toBe(405);
  });

  it('stores the derivative in R2 with immutable metadata', async () => {
    const response = await dispatch(`https://johorstudio.com/s/_r2/t/${KEY}/1600.webp`, {
      method: 'PUT',
      body: 'uploaded-bytes',
      headers: { 'x-upload-secret': UPLOAD_SECRET },
    });
    expect(response.status).toBe(201);

    const bucket = await mf.getR2Bucket('GALLERY');
    const object = await bucket.get(`t/${KEY}/1600.webp`);
    expect(await object?.text()).toBe('uploaded-bytes');
    expect(object?.httpMetadata?.contentType).toBe('image/webp');
    expect(object?.httpMetadata?.cacheControl).toBe('public, max-age=31536000, immutable');

    const served = await dispatch(`https://johorstudio.com/s/t/${KEY}/1600.webp`);
    expect(await served.text()).toBe('uploaded-bytes');
  });
});

describe('worker failure path', () => {
  it('returns the BM 502 page when the origin fetch rejects', async () => {
    const response = await worker.fetch(new Request('https://johorstudio.com/s/portal'), {
      ORIGIN: {
        fetch: async () => {
          throw new Error('tunnel down');
        },
      },
      GALLERY: {} as R2Bucket,
      UPLOAD_SECRET,
      ORIGIN_SECRET,
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('Galeri tidak dapat dicapai');
  });
});
