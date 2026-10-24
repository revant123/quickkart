import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';

// ---------------------------------------------------------------------------
// Database migrations: numbered SQL files in api/migrations/, applied in order.
//
//   0001_baseline.sql, 0002_..., 0003_...
//
// Each file runs ONCE, inside a transaction, and is recorded in the
// schema_migrations table. Change the schema by ADDING a new file; never edit
// one that has already run somewhere.
//
// Several API containers may start at the same moment. A PostgreSQL advisory
// lock makes them take turns: the first applies the migrations, the others
// wait, then find nothing left to do.
// ---------------------------------------------------------------------------

// Works from src/ (tsx) and dist/ (compiled): both sit next to api/migrations
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

const LOCK_ID = 7_310_001; // any fixed number, shared by every API instance

export async function migrate(pool: pg.Pool, log: (m: string) => void = console.log) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
      log(`migrated: ${version}`);
      count++;
    }
    if (count === 0) log('migrations: up to date');
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
