import pg from 'pg';
import { config } from './config.js';

// A pool keeps a few connections open and lends them to requests.
// Opening a new PostgreSQL connection per request would be slow.
// Size it so (number of API containers) x DB_POOL_MAX stays well under
// PostgreSQL's max_connections (100 by default).
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX });

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

// PostgreSQL error codes that mean "nothing was changed, just try again":
//   40001 serialization_failure, 40P01 deadlock_detected
const RETRYABLE = new Set(['40001', '40P01']);

/**
 * Retries `fn` a few times if PostgreSQL aborted it with a transient error.
 * Safe because an aborted transaction changed nothing. Waits a little longer
 * each time, plus random "jitter" so retries don't collide again.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (!RETRYABLE.has(e?.code) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 * 2 ** i + Math.random() * 20));
    }
  }
}

/** Anything you can run a query on: the pool, or a client inside a transaction. */
export type Queryable = pg.Pool | pg.PoolClient;
