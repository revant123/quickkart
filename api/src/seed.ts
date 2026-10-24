import { readFile } from 'node:fs/promises';
import type pg from 'pg';

/**
 * Loads the sample data (db/seed/seed.sql) if the database has no stores yet.
 * Used on fresh deploys (SEED_ON_EMPTY=true) so the live demo isn't an empty shop.
 *
 * - An advisory lock makes sure only one instance seeds, even if several start at once.
 * - One transaction: a failure halfway leaves no half-loaded catalog behind.
 * Returns true if it loaded the data.
 */
export async function seedIfEmpty(pool: pg.Pool, file: string, log = console.log): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7310002)');
    const { rows } = await client.query('SELECT EXISTS (SELECT 1 FROM stores) AS has_data');
    if (rows[0].has_data) return false;
    log('seed: empty database, loading sample data (takes a minute)...');
    const sql = await readFile(file, 'utf8');
    const started = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(sql); // many statements in one go (simple query protocol)
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    log(`seed: done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return true;
  } finally {
    await client.query('SELECT pg_advisory_unlock(7310002)').catch(() => {});
    client.release();
  }
}
