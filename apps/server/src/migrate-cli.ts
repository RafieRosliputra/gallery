import { runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (see .env.example)');
  process.exit(1);
}

try {
  const { applied, alreadyApplied } = await runMigrations({
    databaseUrl,
    ...(process.env.MIGRATIONS_DIR ? { migrationsDir: process.env.MIGRATIONS_DIR } : {}),
  });
  console.log(
    applied.length > 0
      ? `migrations: applied ${applied.join(', ')} (${alreadyApplied} already applied)`
      : `migrations: up to date (${alreadyApplied} already applied)`,
  );
} catch (error) {
  console.error('migrations: failed', error);
  process.exit(1);
}
