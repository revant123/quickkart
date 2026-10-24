import { pool } from './db.js';

// ---------------------------------------------------------------------------
// Background jobs: small tasks that run on a timer inside the API process.
//
// With several API containers running, each would start the same timer. To
// make a job run on only ONE of them at a time, each run first tries to take
// a PostgreSQL advisory lock (pg_try_advisory_lock). Whoever gets it does the
// work; the others skip this round. No extra service (cron, worker) needed,
// which also keeps hosting on a free tier possible.
// ---------------------------------------------------------------------------

export type Job = {
  name: string;
  everyMs: number;
  lockId: number; // unique per job
  run: () => Promise<string | void>; // optional summary for the log
};

/** Runs `job` once, if no other instance is running it. Returns false if skipped. */
export async function runExclusive(job: Job): Promise<boolean> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [job.lockId]);
    if (!rows[0].got) return false;
    try {
      const summary = await job.run();
      if (summary) console.log(`[job ${job.name}] ${summary}`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [job.lockId]);
    }
    return true;
  } catch (e) {
    console.error(`[job ${job.name}] failed:`, (e as Error).message);
    return false;
  } finally {
    client.release();
  }
}

/** Starts every job on its timer. Returns a function that stops them all. */
export function startJobs(jobs: Job[]): () => void {
  const timers = jobs.map((job) => {
    // First run shortly after start-up (staggered), then on the interval
    const first = setTimeout(() => void runExclusive(job), 5_000 + Math.random() * 5_000);
    const every = setInterval(() => void runExclusive(job), job.everyMs);
    first.unref();
    every.unref(); // timers alone don't keep the process alive
    return [first, every];
  });
  return () => timers.flat().forEach((t) => clearTimeout(t));
}

// ---- The jobs -------------------------------------------------------------

/**
 * Idempotency keys only need to live long enough to catch retries. After 24 h
 * they're deleted, in small batches so a huge backlog never holds locks for long.
 * (idx_idempotency_created makes finding old keys cheap.)
 */
export const cleanupIdempotencyKeys: Job = {
  name: 'cleanup-idempotency-keys',
  everyMs: 60 * 60 * 1000, // hourly
  lockId: 7_320_001,
  async run() {
    let total = 0;
    for (;;) {
      const { rowCount } = await pool.query(
        `DELETE FROM idempotency_keys
          WHERE ctid IN (SELECT ctid FROM idempotency_keys
                          WHERE created_at < now() - interval '24 hours' LIMIT 5000)`,
      );
      total += rowCount ?? 0;
      if (!rowCount || rowCount < 5000) break;
    }
    return total ? `deleted ${total} keys older than 24 h` : undefined;
  },
};

// Jobs from other modules register here too
import { sendOutbox } from './notifications/outbox.js';
import { expireUnpaidOrders, processRefunds } from './modules/payments/service.js';

export const ALL_JOBS: Job[] = [cleanupIdempotencyKeys, sendOutbox, expireUnpaidOrders, processRefunds];
