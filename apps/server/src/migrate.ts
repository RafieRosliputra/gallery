import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const FILENAME_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_NAME = 'johorstudio-gallery:migrations';

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

interface MigrationFile {
  filename: string;
  checksum: string;
  sql: string;
}

async function readMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(migrationsDir)).filter((name) => FILENAME_PATTERN.test(name)).sort();
  return Promise.all(
    entries.map(async (filename) => {
      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      return {
        filename,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
        sql,
      };
    }),
  );
}

/**
 * Forward-only numbered SQL migrations, one transaction per file, guarded by a
 * Postgres advisory lock so two containers cannot race on startup.
 */
export async function runMigrations(options: {
  databaseUrl: string;
  migrationsDir?: string;
}): Promise<MigrationResult> {
  const migrationsDir = options.migrationsDir ?? path.resolve(process.cwd(), 'db/migrations');
  const files = await readMigrationFiles(migrationsDir);
  const client = new Client({ connectionString: options.databaseUrl });
  const applied: string[] = [];

  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_NAME]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations ORDER BY filename',
    );
    const known = new Map(rows.map((row) => [row.filename, row.checksum]));

    for (const file of files) {
      const previous = known.get(file.filename);
      if (previous !== undefined) {
        if (previous !== file.checksum) {
          throw new Error(
            `migration ${file.filename} was modified after it was applied; add a new migration instead`,
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file.filename,
          file.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file.filename} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      applied.push(file.filename);
    }

    const missingOnDisk = rows.filter((row) => !files.some((file) => file.filename === row.filename));
    if (missingOnDisk.length > 0) {
      throw new Error(
        `applied migrations missing from ${migrationsDir}: ${missingOnDisk.map((row) => row.filename).join(', ')}`,
      );
    }

    return { applied, alreadyApplied: rows.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_NAME]).catch(() => undefined);
    await client.end();
  }
}
