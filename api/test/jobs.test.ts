import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { pool } from '../src/db.js';
import { cleanupIdempotencyKeys, runExclusive, type Job } from '../src/jobs.js';
import { resetDb } from './helpers.js';

afterAll(() => pool.end());
beforeEach(resetDb);

describe('background jobs', () => {
  it('deletes idempotency keys older than 24 hours, keeps recent ones', async () => {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ('a@example.com', 'x', 'A') RETURNING id`,
    );
    const uid = rows[0].id;
    await pool.query(
      `INSERT INTO idempotency_keys (user_id, key, request_hash, created_at) VALUES
         ($1, 'old-1', 'h', now() - interval '25 hours'),
         ($1, 'old-2', 'h', now() - interval '3 days'),
         ($1, 'new-1', 'h', now() - interval '1 hour')`,
      [uid],
    );

    expect(await runExclusive(cleanupIdempotencyKeys)).toBe(true);

    const left = await pool.query('SELECT key FROM idempotency_keys ORDER BY key');
    expect(left.rows.map((r) => r.key)).toEqual(['new-1']);
  });

  it('only one instance runs a job at a time (advisory lock)', async () => {
    let running = 0;
    let maxConcurrent = 0;
    let runs = 0;
    const slowJob: Job = {
      name: 'slow',
      everyMs: 1000,
      lockId: 7_399_999,
      async run() {
        running++;
        runs++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, 200));
        running--;
      },
    };
    // Five "API containers" fire the same job at the same moment
    const results = await Promise.all(Array.from({ length: 5 }, () => runExclusive(slowJob)));

    expect(maxConcurrent).toBe(1);
    expect(runs).toBe(1);
    expect(results.filter(Boolean)).toHaveLength(1); // the other four skipped
  });
});
