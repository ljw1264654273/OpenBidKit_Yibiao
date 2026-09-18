import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(sourceDir, '../migrations');
const pool = new Pool({ connectionString: databaseUrl });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(2026091701)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const applied = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(applied.rows.map((row) => row.version));
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (appliedVersions.has(file)) continue;
      const migration = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(migration);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(2026091701)').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

void migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
