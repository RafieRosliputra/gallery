import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { createPool, requireTestDatabaseUrl, resetAndMigrate } from './helpers/db.ts';
import { runMigrations } from '../src/migrate.ts';

describe('db/migrations/001_init.sql', () => {
  let pool: Pool;

  beforeAll(async () => {
    const applied = await resetAndMigrate();
    expect(applied).toEqual([
      '001_init.sql',
      '002_ingest.sql',
      '003_api.sql',
      '004_album_folder_recursive_default.sql',
      '005_requeue.sql',
      '006_album_rules.sql',
    ]);
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies cleanly and creates every SPEC table', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'admin',
      'admin_session',
      'album',
      'album_folder',
      'asset',
      'client',
      'folder',
      'job_error',
      'login_failure',
      'scan_run',
      'schema_migrations',
      'slug_registry',
    ]);
  });

  it('is idempotent on a second run', async () => {
    const result = await runMigrations({ databaseUrl: requireTestDatabaseUrl() });
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(6);
  });

  it('rejects slugs outside [a-z0-9-]{3,60}', async () => {
    await expect(
      pool.query("INSERT INTO client (name, slug) VALUES ('Klien Demo', 'Bad Slug')"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("INSERT INTO client (name, slug) VALUES ('Klien Demo', 'ab')"),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces one slug namespace shared by client and album', async () => {
    await pool.query("INSERT INTO client (name, slug) VALUES ('Klien Demo', 'klien-demo')");

    await expect(
      pool.query(
        `INSERT INTO album (client_id, title, slug)
         SELECT id, 'Album Demo', 'klien-demo' FROM client WHERE slug = 'klien-demo'`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('moves the registry row on slug update and frees it on delete', async () => {
    const client = await pool.query<{ id: string }>(
      "INSERT INTO client (name, slug) VALUES ('Tadika Contoh', 'tadika-contoh') RETURNING id",
    );
    const clientId = client.rows[0]?.id;
    expect(clientId).toBeDefined();

    const album = await pool.query<{ id: string }>(
      "INSERT INTO album (client_id, title, slug) VALUES ($1, 'Album Contoh', 'album-contoh') RETURNING id",
      [clientId],
    );
    const albumId = album.rows[0]?.id;

    await expect(
      pool.query("UPDATE album SET slug = 'tadika-contoh' WHERE id = $1", [albumId]),
    ).rejects.toMatchObject({ code: '23505' });

    await pool.query("UPDATE album SET slug = 'album-baru' WHERE id = $1", [albumId]);
    const moved = await pool.query(
      "SELECT 1 FROM slug_registry WHERE slug = 'album-baru' AND kind = 'album'",
    );
    expect(moved.rowCount).toBe(1);

    await pool.query('DELETE FROM album WHERE id = $1', [albumId]);
    const freed = await pool.query("SELECT 1 FROM slug_registry WHERE slug = 'album-baru'");
    expect(freed.rowCount).toBe(0);

    await pool.query("INSERT INTO client (name, slug) VALUES ('Klien Demo 2', 'album-baru')");
  });
});

describe('GET /s/api/health', () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(() => {
    pool = createPool();
    app = buildApp({ pool, version: 'test-1.2.3' });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('returns 200 {ok, version, db:"up"} when Postgres answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/s/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: 'test-1.2.3', db: 'up' });
  });

  it('returns 503 db:"down" when Postgres is unreachable', async () => {
    const downPool = new Pool({
      connectionString: 'postgres://gallery:gallery@127.0.0.1:1/gallery_test',
      connectionTimeoutMillis: 500,
    });
    const downApp = buildApp({ pool: downPool, version: 'test-1.2.3' });
    try {
      const response = await downApp.inject({ method: 'GET', url: '/s/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ ok: false, version: 'test-1.2.3', db: 'down' });
    } finally {
      await downApp.close();
      await downPool.end();
    }
  });
});
