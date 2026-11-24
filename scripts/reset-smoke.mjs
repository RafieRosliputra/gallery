// CI image-smoke helper: start from an empty schema so the smoke seed owns the
// shared slug namespace (integration tests leave their own fixtures behind).
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error(`refusing to reset database "${databaseName}" (name must end with _test)`);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
  await client.query('CREATE SCHEMA public');
  console.log('smoke reset: schema clean');
} finally {
  await client.end();
}
