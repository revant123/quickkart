// npm run migrate: apply pending migrations and exit.
import { pool } from './db.js';
import { migrate } from './migrate.js';

try {
  await migrate(pool);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
