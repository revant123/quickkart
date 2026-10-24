// Runs once before all test files: bring the test database's schema up to date.
import pg from 'pg';
import { migrate } from '../src/migrate.js';

export default async function setup() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await migrate(pool, () => {});
  } finally {
    await pool.end();
  }
}
