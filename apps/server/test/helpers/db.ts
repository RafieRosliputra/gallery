import { Pool } from 'pg';
import { runMigrations } from '../../src/migrate.ts';

export function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for integration tests (see .env.example)');
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `refusing to run destructive tests against database "${databaseName}" (name must end with _test)`,
    );
  }
  return databaseUrl;
}

/** Drops both the app schema and pg-boss' schema, then runs all migrations. */
export async function resetAndMigrate(): Promise<string[]> {
  const url = requireTestDatabaseUrl();
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
  const { applied } = await runMigrations({ databaseUrl: url });
  return applied;
}

export function createPool(max = 4): Pool {
  return new Pool({ connectionString: requireTestDatabaseUrl(), max });
}
