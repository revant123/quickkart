import pg from 'pg';
import { config } from './config.js';

// A pool keeps a few connections open and lends them to requests.
// Opening a new PostgreSQL connection per request would be slow.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

/**
 * Runs `fn` inside ONE transaction on ONE borrowed connection.
 * Everything commits together, or (if anything throws) rolls back together.
 *
 * Why borrow a single client? A transaction belongs to a connection.
 * pool.query('BEGIN') followed by pool.query('UPDATE ...') could run on two
 * different connections, and the "transaction" would silently not be one.
 */
export async function withTransaction<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // always return the connection to the pool
  }
}
