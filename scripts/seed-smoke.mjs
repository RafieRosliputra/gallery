// Image-smoke fixture for CI (and local `docker run` checks).
// Fake client, no client data (AGENTS §2.7). Idempotent: safe to re-run.
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');

  // Select-then-insert: the slug_registry trigger fires before an
  // INSERT ... ON CONFLICT (slug) can resolve, so ON CONFLICT is not usable here.
  let clientId = (await client.query('SELECT id FROM client WHERE slug = $1', ['tadika-contoh-klien']))
    .rows[0]?.id;
  if (!clientId) {
    clientId = (
      await client.query(
        `INSERT INTO client (name, slug) VALUES ('Tadika Contoh', 'tadika-contoh-klien') RETURNING id`,
      )
    ).rows[0].id;
  }

  const folderRow = await client.query(
    `INSERT INTO folder (path) VALUES ('.')
     ON CONFLICT (path) DO UPDATE SET path = EXCLUDED.path
     RETURNING id`,
  );
  const folderId = folderRow.rows[0].id;

  let albumId = (await client.query('SELECT id FROM album WHERE slug = $1', ['tadika-contoh'])).rows[0]?.id;
  if (!albumId) {
    albumId = (
      await client.query(
        `INSERT INTO album (client_id, title, slug, allow_download)
         VALUES ($1, 'Tadika Contoh', 'tadika-contoh', true) RETURNING id`,
        [clientId],
      )
    ).rows[0].id;
  }

  await client.query(
    `INSERT INTO album_folder (album_id, folder_id, recursive)
     VALUES ($1, $2, true)
     ON CONFLICT (album_id, folder_id) DO UPDATE SET recursive = true`,
    [albumId, folderId],
  );

  await client.query(
    `INSERT INTO asset (path, folder_id, camera, size, mtime, deriv_key, taken_at, w, h, mime, thumb_ok)
     VALUES ('Tadika Contoh/tadika-contoh-01.jpg', $1, 'Cam 1', 1024, now(), $2,
             '2026-11-01T09:00:00Z', 800, 1200, 'image/jpeg', true)
     ON CONFLICT (path) DO NOTHING`,
    [folderId, 'f'.repeat(40)],
  );

  await client.query('COMMIT');
  console.log(`smoke seed: album tadika-contoh (id ${albumId}) ready`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
