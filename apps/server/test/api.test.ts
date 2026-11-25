import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { fromBuffer, type Entry } from 'yauzl';
import { buildApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/passwords.ts';
import { createSession } from '../src/auth/sessions.ts';
import { derivativeDirectory } from '../src/thumbs/generate.ts';
import { createPool, resetAndMigrate } from './helpers/db.ts';
import { writeJpeg, writeWebp } from './helpers/fixtures.ts';

const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);
const KEY_C = 'c'.repeat(40);
const KEY_D = 'd'.repeat(40);

interface Ids {
  root: string;
  klien: string;
  albumA: string;
  cam2: string;
  albumB: string;
  lain: string;
  clientKlien: string;
  albumASlug: string;
  albumBSlug: string;
  a1: string;
  a2: string;
  b1: string;
  d1: string;
  adminCookie: string;
}

describe('public and admin API', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let sourceRoot: string;
  let dataDir: string;
  let ids: Ids;
  let scanCalls = 0;
  let scanResult = true;

  beforeAll(async () => {
    await resetAndMigrate();
    pool = createPool(6);
    sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'api-source-'));
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'api-data-'));

    ids = await seed();

    app = buildApp({
      pool,
      version: 'test',
      dataDir,
      sourceRoot,
      thumbBase: '/s/t',
      timezone: 'UTC',
      r2Enabled: true,
      triggerScan: async () => {
        scanCalls += 1;
        return scanResult;
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('resolves client and album slugs, 404 for unknown', async () => {
    const client = await app.inject({ method: 'GET', url: '/s/api/resolve/klien-demo' });
    expect(client.statusCode).toBe(200);
    expect(client.json()).toMatchObject({ kind: 'client', client: { slug: 'klien-demo' } });

    const album = await app.inject({ method: 'GET', url: '/s/api/resolve/album-a' });
    expect(album.statusCode).toBe(200);
    expect(album.json()).toMatchObject({
      kind: 'album',
      album: { slug: 'album-a', allowDownload: true },
      client: { slug: 'klien-demo' },
    });

    const missing = await app.inject({ method: 'GET', url: '/s/api/resolve/nope-nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('lists client albums with counts and covers, never asset lists', async () => {
    const response = await app.inject({ method: 'GET', url: '/s/api/client/klien-demo' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.client).toMatchObject({ slug: 'klien-demo' });
    expect(body.albums).toHaveLength(2);
    const albumA = body.albums.find((album: { slug: string }) => album.slug === 'album-a');
    expect(albumA).toMatchObject({ count: 2, allowDownload: true });
    expect(albumA.cover).toMatchObject({ id: ids.a2, thumb: `/s/t/${KEY_B}/300.webp` });
    expect(albumA.cover.original).toContain('album=album-a');
    expect(body.assets).toBeUndefined();

    const albumB = body.albums.find((album: { slug: string }) => album.slug === 'album-b');
    expect(albumB).toMatchObject({ count: 1, allowDownload: false });
  });

  it('returns album meta with camera tabs and month buckets, never assets', async () => {
    const response = await app.inject({ method: 'GET', url: '/s/api/album/album-a' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.album).toMatchObject({ slug: 'album-a', allowDownload: true });
    expect(body.cameras).toEqual(['Cam 1', 'Cam 2']);
    expect(body.buckets).toEqual([{ key: '2024-05', count: 2 }]);
    expect(body.total).toBe(2);
    expect(body.thumbBase).toBe('/s/t');
    expect(body.assets).toBeUndefined();

    const cam = await app.inject({ method: 'GET', url: '/s/api/album/album-a?cam=Cam%202' });
    expect(cam.json()).toMatchObject({ total: 1, cameras: ['Cam 1', 'Cam 2'] });
  });

  it('pages a bucket with keyset cursors and respects the 500 cap', async () => {
    const first = await app.inject({ method: 'GET', url: '/s/api/bucket/2024-05?album=album-a&limit=1' });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.assets).toHaveLength(1);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(firstBody.assets[0].id).toBe(ids.a2);
    expect(firstBody.assets[0].thumb).toBe(`/s/t/${KEY_B}/300.webp`);
    expect(firstBody.assets[0].preview).toBe(`/s/t/${KEY_B}/1600.webp`);
    expect(firstBody.assets[0].original).toContain('album=album-a');

    const second = await app.inject({
      method: 'GET',
      url: `/s/api/bucket/2024-05?album=album-a&limit=1&cursor=${firstBody.nextCursor}`,
    });
    const secondBody = second.json();
    expect(secondBody.assets).toHaveLength(1);
    expect(secondBody.assets[0].id).toBe(ids.a1);
    expect(secondBody.nextCursor).toBeNull();

    const tooBig = await app.inject({ method: 'GET', url: '/s/api/bucket/2024-05?album=album-a&limit=9999' });
    expect(tooBig.statusCode).toBe(200);
    expect(tooBig.json().assets.length).toBeLessThanOrEqual(500);

    const bad = await app.inject({ method: 'GET', url: '/s/api/bucket/2024-05?album=album-a&cursor=not-a-cursor' });
    expect(bad.statusCode).toBe(400);
  });

  it('serves local derivative fallback with immutable caching', async () => {
    const response = await app.inject({ method: 'GET', url: `/s/t/${KEY_A}/300.webp` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.rawPayload.length).toBeGreaterThan(0);

    const missing = await app.inject({ method: 'GET', url: `/s/t/${'0'.repeat(40)}/300.webp` });
    expect(missing.statusCode).toBe(404);
    const traversal = await app.inject({ method: 'GET', url: '/s/t/not-a-key/300.webp' });
    expect(traversal.statusCode).toBe(404);
    const wrongSize = await app.inject({ method: 'GET', url: `/s/t/${KEY_A}/999.webp` });
    expect(wrongSize.statusCode).toBe(404);
  });

  it('enforces original scope: album links cannot fetch another album', async () => {
    const anonymous = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a1}` });
    expect(anonymous.statusCode).toBe(401);

    const wrongAlbum = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a1}?album=album-b` });
    expect(wrongAlbum.statusCode).toBe(403);

    const scoped = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a1}?album=album-a` });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.headers['content-type']).toBe('image/jpeg');
    expect(scoped.headers['cache-control']).toBe('private, no-store');

    // allow_download=false blocks the original for public links, not the preview.
    const downloadOff = await app.inject({ method: 'GET', url: `/s/api/o/${ids.b1}?album=album-b` });
    expect(downloadOff.statusCode).toBe(403);
    expect(downloadOff.json()).toMatchObject({ error: 'download_disabled' });
    const preview = await app.inject({ method: 'GET', url: `/s/t/${KEY_C}/1600.webp` });
    expect(preview.statusCode).toBe(200);

    const admin = await app.inject({
      method: 'GET',
      url: `/s/api/o/${ids.b1}`,
      headers: { cookie: ids.adminCookie },
    });
    expect(admin.statusCode).toBe(200);

    // An admin session is always allowed, even on an allow_download=false album.
    const adminScoped = await app.inject({
      method: 'GET',
      url: `/s/api/o/${ids.b1}?album=album-b`,
      headers: { cookie: ids.adminCookie },
    });
    expect(adminScoped.statusCode).toBe(200);
  });

  it('looks up one asset with the same scope rules as originals', async () => {
    const anonymous = await app.inject({ method: 'GET', url: `/s/api/asset/${ids.a1}` });
    expect(anonymous.statusCode).toBe(401);

    const wrongAlbum = await app.inject({ method: 'GET', url: `/s/api/asset/${ids.a1}?album=album-b` });
    expect(wrongAlbum.statusCode).toBe(403);

    const scoped = await app.inject({ method: 'GET', url: `/s/api/asset/${ids.a1}?album=album-a` });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.headers['cache-control']).toBe('no-store');
    expect(scoped.json()).toMatchObject({
      albumSlug: 'album-a',
      asset: {
        id: ids.a1,
        mime: 'image/jpeg',
        thumb: `/s/t/${KEY_A}/300.webp`,
        preview: `/s/t/${KEY_A}/1600.webp`,
      },
    });
    expect(scoped.json().asset.original).toContain('album=album-a');

    // allow_download=false still exposes metadata; only the original is gated.
    const downloadOff = await app.inject({ method: 'GET', url: `/s/api/asset/${ids.b1}?album=album-b` });
    expect(downloadOff.statusCode).toBe(200);

    const admin = await app.inject({
      method: 'GET',
      url: `/s/api/asset/${ids.a1}`,
      headers: { cookie: ids.adminCookie },
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toMatchObject({ albumSlug: null, asset: { id: ids.a1 } });

    const missing = await app.inject({ method: 'GET', url: '/s/api/asset/999999?album=album-a' });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: 'GET', url: '/s/api/asset/not-a-number?album=album-a' });
    expect(bad.statusCode).toBe(400);
  });

  it('returns enriched admin albums (count, cameras, covers) in one list response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/s/api/admin/albums',
      headers: { cookie: ids.adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const albums = response.json().albums as {
      id: string;
      slug: string;
      count: number;
      cameras: string[];
      covers: { id: string; thumb: string }[];
      clientName: string;
    }[];
    const albumA = albums.find((album) => album.slug === 'album-a');
    expect(albumA).toMatchObject({
      count: 2,
      cameras: ['Cam 1', 'Cam 2'],
      clientName: 'Klien Demo',
    });
    expect(albumA?.covers.map((cover) => cover.id)).toEqual([ids.a2, ids.a1]);
    expect(albumA?.covers[0]?.thumb).toBe(`/s/t/${KEY_B}/300.webp`);

    const albumB = albums.find((album) => album.slug === 'album-b');
    expect(albumB).toMatchObject({ count: 1, cameras: [] });
    expect(albumB?.covers).toHaveLength(1);
  });

  it('streams a ZIP with allow_download enforced, ids and cam filters, no full album leak', async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: '/s/api/zip',
      payload: { albumSlug: 'album-b' },
    });
    expect(blocked.statusCode).toBe(403);

    const all = await app.inject({
      method: 'POST',
      url: '/s/api/zip',
      payload: { albumSlug: 'album-a' },
    });
    expect(all.statusCode).toBe(200);
    expect(all.headers['content-type']).toBe('application/zip');
    expect(all.headers['content-disposition']).toBe('attachment; filename="album-a.zip"');
    const entries = await readZip(all.rawPayload);
    expect([...entries.keys()].sort()).toEqual(['a1.jpg', 'a2.jpg']);

    const onlyOne = await app.inject({
      method: 'POST',
      url: '/s/api/zip',
      payload: { albumSlug: 'album-a', ids: [ids.a1] },
    });
    expect([...(await readZip(onlyOne.rawPayload)).keys()]).toEqual(['a1.jpg']);

    const cam2 = await app.inject({
      method: 'POST',
      url: '/s/api/zip',
      payload: { albumSlug: 'album-a', cam: 'Cam 2' },
    });
    expect([...(await readZip(cam2.rawPayload)).keys()]).toEqual(['a2.jpg']);

    // b1 belongs to album-b; asking for it through album-a must yield an empty zip.
    const crossAlbum = await app.inject({
      method: 'POST',
      url: '/s/api/zip',
      payload: { albumSlug: 'album-a', ids: [ids.b1] },
    });
    expect((await readZip(crossAlbum.rawPayload)).size).toBe(0);
  });

  it('returns 409 with a slug message for shared-namespace conflicts', async () => {
    const clientConflict = await app.inject({
      method: 'POST',
      url: '/s/api/admin/clients',
      headers: { cookie: ids.adminCookie },
      payload: { name: 'Klien Baru', slug: 'album-a' },
    });
    expect(clientConflict.statusCode).toBe(409);
    expect(clientConflict.json()).toMatchObject({
      error: 'slug_conflict',
      message: expect.stringContaining('already used'),
    });

    const albumConflict = await app.inject({
      method: 'POST',
      url: '/s/api/admin/albums',
      headers: { cookie: ids.adminCookie },
      payload: { client_id: ids.clientKlien, title: 'Album Baru', slug: 'klien-demo' },
    });
    expect(albumConflict.statusCode).toBe(409);
    expect(albumConflict.json().error).toBe('slug_conflict');

    const invalid = await app.inject({
      method: 'POST',
      url: '/s/api/admin/clients',
      headers: { cookie: ids.adminCookie },
      payload: { name: 'Klien Baru', slug: 'Bad Slug' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('bad_slug');
  });

  it('supports admin client/album CRUD and album_folder add/remove', async () => {
    const client = await app.inject({
      method: 'POST',
      url: '/s/api/admin/clients',
      headers: { cookie: ids.adminCookie },
      payload: { name: 'Klien Baru', slug: 'klien-baru' },
    });
    expect(client.statusCode).toBe(201);
    const clientId = client.json().client.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/s/api/admin/clients/${clientId}`,
      headers: { cookie: ids.adminCookie },
      payload: { name: 'Klien Baru 2', slug: 'klien-baru-2' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().client).toMatchObject({ name: 'Klien Baru 2', slug: 'klien-baru-2' });

    const album = await app.inject({
      method: 'POST',
      url: '/s/api/admin/albums',
      headers: { cookie: ids.adminCookie },
      payload: { client_id: clientId, title: 'Album Baru', slug: 'album-baru', allow_download: false },
    });
    expect(album.statusCode).toBe(201);
    const albumId = album.json().album.id;
    expect(album.json().album).toMatchObject({ allowDownload: false, clientSlug: 'klien-baru-2' });

    const updated = await app.inject({
      method: 'PATCH',
      url: `/s/api/admin/albums/${albumId}`,
      headers: { cookie: ids.adminCookie },
      payload: { title: 'Album Baru 2', allow_download: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().album).toMatchObject({ title: 'Album Baru 2', allowDownload: true });

    const added = await app.inject({
      method: 'POST',
      url: `/s/api/admin/albums/${albumId}/folders`,
      headers: { cookie: ids.adminCookie },
      payload: { folderId: ids.albumA, recursive: true },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().folder).toMatchObject({ folder_id: ids.albumA, recursive: true });

    const folders = await app.inject({
      method: 'GET',
      url: `/s/api/admin/albums/${albumId}/folders`,
      headers: { cookie: ids.adminCookie },
    });
    expect(folders.json().folders).toHaveLength(1);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/s/api/admin/albums/${albumId}/folders/${ids.albumA}`,
      headers: { cookie: ids.adminCookie },
    });
    expect(removed.statusCode).toBe(204);

    // recursive defaults to true: an album folder covers its Cam N subtree.
    const defaulted = await app.inject({
      method: 'POST',
      url: `/s/api/admin/albums/${albumId}/folders`,
      headers: { cookie: ids.adminCookie },
      payload: { folderId: ids.albumA },
    });
    expect(defaulted.statusCode).toBe(200);
    expect(defaulted.json().folder).toMatchObject({ folder_id: ids.albumA, recursive: true });

    const dbDefault = await pool.query<{ recursive: boolean }>(
      'INSERT INTO album_folder (album_id, folder_id) VALUES ($1, $2) RETURNING recursive',
      [albumId, ids.lain],
    );
    expect(dbDefault.rows[0]?.recursive).toBe(true);

    const deletedAlbum = await app.inject({
      method: 'DELETE',
      url: `/s/api/admin/albums/${albumId}`,
      headers: { cookie: ids.adminCookie },
    });
    expect(deletedAlbum.statusCode).toBe(204);
    const deletedClient = await app.inject({
      method: 'DELETE',
      url: `/s/api/admin/clients/${clientId}`,
      headers: { cookie: ids.adminCookie },
    });
    expect(deletedClient.statusCode).toBe(204);
  });

  it('applies include/exclude folder rules and serves album folder navigation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/s/api/admin/albums',
      headers: { cookie: ids.adminCookie },
      payload: { client_id: ids.clientKlien, title: 'Rules', slug: 'album-rules', allow_download: false },
    });
    expect(created.statusCode).toBe(201);
    const albumId = created.json().album.id as string;
    const rules = [
      { folderId: ids.klien, included: true },
      { folderId: ids.cam2, included: false },
    ];

    const preview = await app.inject({
      method: 'POST',
      url: '/s/api/admin/scope-preview',
      headers: { cookie: ids.adminCookie },
      payload: { rules },
    });
    expect(preview.json()).toMatchObject({ assetCount: 2 });

    const saved = await app.inject({
      method: 'PUT',
      url: `/s/api/admin/albums/${albumId}/folders`,
      headers: { cookie: ids.adminCookie },
      payload: { rules },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ rules: 2, assetCount: 2 });

    const listed = await app.inject({
      method: 'GET',
      url: `/s/api/admin/albums/${albumId}/folders`,
      headers: { cookie: ids.adminCookie },
    });
    expect(listed.json().folders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ folderId: ids.klien, included: true }),
        expect.objectContaining({ folderId: ids.cam2, included: false }),
      ]),
    );

    const bad = await app.inject({
      method: 'PUT',
      url: `/s/api/admin/albums/${albumId}/folders`,
      headers: { cookie: ids.adminCookie },
      payload: { rules: [{ folderId: ids.klien, included: 'yes' }] },
    });
    expect(bad.statusCode).toBe(400);

    // Single top folder (Klien Demo) is the album top: its subfolders are the cards.
    const top = await app.inject({ method: 'GET', url: '/s/api/album/album-rules/folders' });
    expect(top.statusCode).toBe(200);
    expect(top.json()).toMatchObject({ folderId: ids.klien, trail: [], assetCount: 0 });
    expect(top.json().folders.map((card: { name: string; count: number }) => [card.name, card.count])).toEqual([
      ['Album A', 1],
      ['Album B', 1],
    ]);
    expect(top.json().folders[0].cover.id).toBe(ids.a1);

    const inside = await app.inject({ method: 'GET', url: `/s/api/album/album-rules/folders?folder=${ids.albumA}` });
    expect(inside.json()).toMatchObject({
      folderId: ids.albumA,
      trail: [{ id: ids.albumA, name: 'Album A' }],
      folders: [],
      assetCount: 1,
    });

    const excluded = await app.inject({ method: 'GET', url: `/s/api/album/album-rules/folders?folder=${ids.cam2}` });
    expect(excluded.statusCode).toBe(404);

    const bucket = await app.inject({ method: 'GET', url: `/s/api/bucket/f:${ids.albumA}?album=album-rules` });
    expect(bucket.statusCode).toBe(200);
    expect(bucket.json().assets.map((asset: { id: string }) => asset.id)).toEqual([ids.a1]);
    const outside = await app.inject({ method: 'GET', url: `/s/api/bucket/f:${ids.cam2}?album=album-rules` });
    expect(outside.json().assets).toEqual([]);

    const scopedOut = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a2}?album=album-rules` });
    expect(scopedOut.statusCode).toBe(403);
    const noDownload = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a1}?album=album-rules` });
    expect(noDownload.json().error).toBe('download_disabled');
    const zoomView = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a1}?album=album-rules&view=1` });
    expect(zoomView.statusCode).not.toBe(403);

    await app.inject({ method: 'DELETE', url: `/s/api/admin/albums/${albumId}`, headers: { cookie: ids.adminCookie } });
  });

  it('creates one album per ticked folder with a unique slug from the folder name', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/s/api/admin/clients/${ids.clientKlien}/albums`,
      headers: { cookie: ids.adminCookie },
      payload: { folderId: ids.albumA },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().album).toMatchObject({ title: 'Album A', slug: 'album-a-2', allowDownload: true });
    const second = await app.inject({
      method: 'POST',
      url: `/s/api/admin/clients/${ids.clientKlien}/albums`,
      headers: { cookie: ids.adminCookie },
      payload: { folderId: ids.albumA },
    });
    expect(second.json().album.slug).toBe('album-a-3');

    const listed = await app.inject({
      method: 'GET',
      url: `/s/api/admin/clients/${ids.clientKlien}/albums`,
      headers: { cookie: ids.adminCookie },
    });
    const created = listed.json().albums.find((album: { id: string }) => album.id === first.json().album.id);
    expect(created).toMatchObject({ count: 2, rules: [{ folderId: ids.albumA, path: 'Klien Demo/Album A', included: true }] });

    for (const response of [first, second]) {
      await app.inject({
        method: 'DELETE',
        url: `/s/api/admin/albums/${response.json().album.id}`,
        headers: { cookie: ids.adminCookie },
      });
    }
  });

  it('stores client and album descriptions and returns them publicly', async () => {
    const text = 'Photography service by johorstudio.com';
    const patched = await app.inject({
      method: 'PATCH',
      url: `/s/api/admin/clients/${ids.clientKlien}`,
      headers: { cookie: ids.adminCookie },
      payload: { description: text },
    });
    expect(patched.json().client.description).toBe(text);
    const portal = await app.inject({ method: 'GET', url: '/s/api/client/klien-demo' });
    expect(portal.json().client.description).toBe(text);
    const album = await app.inject({ method: 'GET', url: `/s/api/album/${ids.albumASlug}` });
    expect(album.json()).toMatchObject({ album: { description: '' }, client: { description: text } });
    const tooLong = await app.inject({
      method: 'PATCH',
      url: `/s/api/admin/clients/${ids.clientKlien}`,
      headers: { cookie: ids.adminCookie },
      payload: { description: 'x'.repeat(1001) },
    });
    expect(tooLong.statusCode).toBe(400);
  });

  it('returns lazy folder children with counts', async () => {
    const root = await app.inject({
      method: 'GET',
      url: '/s/api/admin/folders',
      headers: { cookie: ids.adminCookie },
    });
    expect(root.statusCode).toBe(200);
    expect(root.json().parent).toMatchObject({ id: ids.root, path: '.', name: '/' });
    expect(root.json().folders.map((folder: { path: string }) => folder.path).sort()).toEqual([
      'Klien Demo',
      'Lain',
    ]);

    const klien = await app.inject({
      method: 'GET',
      url: `/s/api/admin/folders?parent=${ids.klien}`,
      headers: { cookie: ids.adminCookie },
    });
    expect(klien.json().parent.path).toBe('Klien Demo');
    expect(klien.json().folders.map((folder: { path: string }) => folder.path).sort()).toEqual([
      'Klien Demo/Album A',
      'Klien Demo/Album B',
    ]);
    const albumANode = klien.json().folders.find((folder: { id: string }) => folder.id === ids.albumA);
    expect(albumANode.hasChildren).toBe(true);
  });

  it('returns admin date/folder buckets and can filter by album', async () => {
    const dates = await app.inject({
      method: 'GET',
      url: '/s/api/buckets?mode=date',
      headers: { cookie: ids.adminCookie },
    });
    expect(dates.statusCode).toBe(200);
    expect(dates.json().buckets).toEqual([
      { key: '2024-07', count: 1 },
      { key: '2024-06', count: 1 },
      { key: '2024-05', count: 2 },
    ]);

    const albumDates = await app.inject({
      method: 'GET',
      url: '/s/api/admin/buckets?mode=date&album=album-a',
      headers: { cookie: ids.adminCookie },
    });
    expect(albumDates.json().buckets).toEqual([{ key: '2024-05', count: 2 }]);

    const folders = await app.inject({
      method: 'GET',
      url: '/s/api/admin/buckets?mode=folder&album=album-a',
      headers: { cookie: ids.adminCookie },
    });
    expect(folders.json().buckets).toEqual(
      expect.arrayContaining([
        { key: `f:${ids.albumA}`, label: 'Klien Demo/Album A', count: 1 },
        { key: `f:${ids.cam2}`, label: 'Klien Demo/Album A/Cam 2', count: 1 },
      ]),
    );
  });

  it('triggers a rescan and reports 409 while one is running', async () => {
    scanCalls = 0;
    scanResult = true;
    const started = await app.inject({
      method: 'POST',
      url: '/s/api/admin/rescan',
      headers: { cookie: ids.adminCookie },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({ started: true });
    expect(scanCalls).toBe(1);

    scanResult = false;
    const running = await app.inject({
      method: 'POST',
      url: '/s/api/admin/rescan',
      headers: { cookie: ids.adminCookie },
    });
    expect(running.statusCode).toBe(409);
  });

  it('reports status with r2Enabled and pendingR2 only when enabled', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/s/api/admin/status',
      headers: { cookie: ids.adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      assets: 4,
      pendingThumbs: 0,
      pendingR2: 3,
      r2Enabled: true,
    });

    const off = buildApp({ pool, version: 'test', r2Enabled: false });
    try {
      const body = await off.inject({
        method: 'GET',
        url: '/s/api/admin/status',
        headers: { cookie: ids.adminCookie },
      });
      expect(body.json()).toMatchObject({ pendingR2: 0, r2Enabled: false });
    } finally {
      await off.close();
    }
  });

  it('uses the hot cache original when the row is fresh', async () => {
    const hot = path.join(dataDir, 'hot', KEY_A);
    await mkdir(path.dirname(hot), { recursive: true });
    await writeFile(hot, 'HOT-BYTES');
    await pool.query("UPDATE asset SET hot_until = now() + interval '1 day' WHERE id = $1", [ids.a1]);
    const response = await app.inject({ method: 'GET', url: `/s/api/o/${ids.a1}?album=album-a` });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(Buffer.from('HOT-BYTES'));
  });

  it('rejects non-allowlisted origin traffic when ORIGIN_SECRET is set', async () => {
    const protectedApp = buildApp({ pool, version: 'test', originSecret: 'top-secret' });
    try {
      const health = await protectedApp.inject({ method: 'GET', url: '/s/api/health' });
      expect(health.statusCode).toBe(200);

      const blocked = await protectedApp.inject({ method: 'GET', url: '/s/api/resolve/klien-demo' });
      expect(blocked.statusCode).toBe(403);

      const allowed = await protectedApp.inject({
        method: 'GET',
        url: '/s/api/resolve/klien-demo',
        headers: { 'x-origin-secret': 'top-secret' },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      await protectedApp.close();
    }
  });

  it('serves the SPA at /s with cache rules and no fallback for API paths', async () => {
    const webDir = await mkdtemp(path.join(os.tmpdir(), 'api-web-'));
    const csp = "default-src 'self'; script-src 'self' 'sha256-testhash='; object-src 'none'";
    try {
      await writeFile(
        path.join(webDir, 'index.html'),
        `<!doctype html><html lang="ms"><head>` +
          `<meta http-equiv="content-security-policy" content="${csp}">` +
          `<title>JohorStudio · Galeri</title></head><body><div class="app-root"></div></body></html>`,
      );
      await mkdir(path.join(webDir, '_app', 'immutable'), { recursive: true });
      await writeFile(path.join(webDir, '_app', 'immutable', 'app.js'), 'console.log("gallery");');
      await writeFile(path.join(webDir, 'logo.png'), 'not-a-real-png');

      const web = buildApp({ pool, version: 'test', webDir });
      try {
        const root = await web.inject({ method: 'GET', url: '/s' });
        expect(root.statusCode).toBe(200);
        expect(root.headers['content-type']).toContain('text/html');
        expect(root.headers['cache-control']).toBe('no-cache');
        expect(root.headers['content-security-policy']).toBe(csp);
        expect(root.headers['x-content-type-options']).toBe('nosniff');
        expect(root.body).toContain('<title>JohorStudio · Galeri</title>');

        const deepLink = await web.inject({ method: 'GET', url: '/s/tadika-contoh?p=123' });
        expect(deepLink.statusCode).toBe(200);
        expect(deepLink.body).toContain('<title>JohorStudio · Galeri</title>');

        const unknown = await web.inject({ method: 'GET', url: '/s/xyz' });
        expect(unknown.statusCode).toBe(200);
        expect(unknown.body).toContain('<title>JohorStudio · Galeri</title>');

        const hashed = await web.inject({ method: 'GET', url: '/s/_app/immutable/app.js' });
        expect(hashed.statusCode).toBe(200);
        expect(hashed.headers['content-type']).toContain('javascript');
        expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable');

        const staticFile = await web.inject({ method: 'GET', url: '/s/logo.png' });
        expect(staticFile.statusCode).toBe(200);
        expect(staticFile.headers['cache-control']).toBe('public, max-age=3600');

        const apiMiss = await web.inject({ method: 'GET', url: '/s/api/nope' });
        expect(apiMiss.statusCode).toBe(404);
        expect(apiMiss.headers['content-type']).toContain('application/json');
        expect(apiMiss.body).not.toContain('<title>');

        const derivativeMiss = await web.inject({ method: 'GET', url: '/s/t/nope/300.webp' });
        expect(derivativeMiss.statusCode).toBe(404);
        const r2Miss = await web.inject({ method: 'GET', url: '/s/_r2/nope' });
        expect(r2Miss.statusCode).toBe(404);

        const traversal = await web.inject({ method: 'GET', url: '/s/..%2f..%2fpackage.json' });
        expect(traversal.statusCode).toBe(200);
        expect(traversal.body).toContain('<title>JohorStudio · Galeri</title>');
      } finally {
        await web.close();
      }
    } finally {
      await rm(webDir, { recursive: true, force: true });
    }
  });

  async function seed(): Promise<Ids> {
    const root = await pool.query<{ id: string }>("INSERT INTO folder (path) VALUES ('.') RETURNING id");
    const rootId = root.rows[0]?.id ?? '';
    const klien = await folder('Klien Demo', rootId);
    const albumA = await folder('Klien Demo/Album A', klien);
    const cam2 = await folder('Klien Demo/Album A/Cam 2', albumA);
    const albumB = await folder('Klien Demo/Album B', klien);
    const lain = await folder('Lain', rootId);

    const client = await pool.query<{ id: string }>(
      "INSERT INTO client (name, slug) VALUES ('Klien Demo', 'klien-demo') RETURNING id",
    );
    const clientKlien = client.rows[0]?.id ?? '';
    const albumAId = await album(clientKlien, 'Album A', 'album-a', true);
    const albumBId = await album(clientKlien, 'Album B', 'album-b', false);
    await pool.query('INSERT INTO album_folder (album_id, folder_id, recursive) VALUES ($1, $2, true)', [
      albumAId,
      albumA,
    ]);
    await pool.query('INSERT INTO album_folder (album_id, folder_id, recursive) VALUES ($1, $2, false)', [
      albumBId,
      albumB,
    ]);

    const a1 = await asset(albumA, 'Klien Demo/Album A/a1.jpg', KEY_A, 'Cam 1', '2024-05-01T10:00:00Z');
    const a2 = await asset(cam2, 'Klien Demo/Album A/Cam 2/a2.jpg', KEY_B, 'Cam 2', '2024-05-02T10:00:00Z');
    const b1 = await asset(albumB, 'Klien Demo/Album B/b1.jpg', KEY_C, null, '2024-06-01T10:00:00Z');
    const d1 = await asset(lain, 'Lain/d1.jpg', KEY_D, null, '2024-07-01T10:00:00Z');
    await pool.query('UPDATE asset SET r2_ok = true WHERE id = $1', [a1]);
    await pool.query('UPDATE asset SET thumb_ok = true');

    for (const key of [KEY_A, KEY_B, KEY_C, KEY_D]) {
      const directory = derivativeDirectory(dataDir, key);
      await writeWebp(path.join(directory, '300.webp'), 30, 20);
      await writeWebp(path.join(directory, '1600.webp'), 160, 100);
    }

    const adminHash = await hashPassword('unused-password');
    const admin = await pool.query<{ id: string }>(
      'INSERT INTO admin (username, pw_hash) VALUES ($1, $2) RETURNING id',
      ['api-admin', adminHash],
    );
    const session = await createSession(pool, admin.rows[0]?.id ?? '');

    return {
      root: rootId,
      klien,
      albumA,
      cam2,
      albumB,
      lain,
      clientKlien,
      albumASlug: 'album-a',
      albumBSlug: 'album-b',
      a1,
      a2,
      b1,
      d1,
      adminCookie: `gallery_session=${session.token}`,
    };

    async function folder(folderPath: string, parentId: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO folder (path, parent_id) VALUES ($1, $2) RETURNING id',
        [folderPath, parentId],
      );
      return rows[0]?.id ?? '';
    }

    async function album(clientId: string, title: string, slug: string, allowDownload: boolean): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO album (client_id, title, slug, allow_download) VALUES ($1, $2, $3, $4) RETURNING id',
        [clientId, title, slug, allowDownload],
      );
      return rows[0]?.id ?? '';
    }

    async function asset(
      folderId: string,
      filePath: string,
      derivKey: string,
      camera: string | null,
      takenAt: string,
    ): Promise<string> {
      await writeJpeg(path.join(sourceRoot, filePath), 80, 60);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO asset (path, folder_id, camera, size, mtime, deriv_key, taken_at, w, h, mime, thumb_ok)
         VALUES ($1, $2, $3, 1024, now(), $4, $5, 80, 60, 'image/jpeg', true) RETURNING id`,
        [filePath, folderId, camera, derivKey, takenAt],
      );
      return rows[0]?.id ?? '';
    }
  }
});

function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map<string, Buffer>();
      zip.on('entry', (entry: Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}
