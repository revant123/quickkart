import { pool, type Queryable } from './db.js';
import { bumpCatalogVersion } from './cache.js';
import { config } from './config.js';

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

/**
 * Opens 30-minute delivery slots for the next 2 days (capacity 5, the sample data's
 * pattern) at every active store, or just `storeId`. Existing slots are left alone
 * (ON CONFLICT on store + start time). Returns how many were opened.
 */
export async function openSlots(db: Queryable, storeId?: number): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity)
     SELECT s.id, t, t + interval '30 minutes', 5
       FROM stores s,
            generate_series(date_trunc('hour', now()) + interval '1 hour',
                            date_trunc('hour', now()) + interval '2 days',
                            interval '30 minutes') AS t
      WHERE s.is_active AND ($1::bigint IS NULL OR s.id = $1)
     ON CONFLICT (store_id, starts_at) DO NOTHING`,
    [storeId ?? null],
  );
  return rowCount ?? 0;
}

/** Keeps every store bookable, so a demo that runs for weeks never shows "no slots". */
export const keepSlotsOpen: Job = {
  name: 'keep-slots-open',
  everyMs: 60 * 60 * 1000, // hourly
  lockId: 7_320_005,
  async run() {
    if (!config.AUTO_SLOTS) return;
    const n = await openSlots(pool);
    return n ? `opened ${n} delivery slots` : undefined;
  },
};

/**
 * Stocks stores that have no products yet (stores added by a migration to an existing
 * database). Runs soon after start-up, in the background, so a deploy isn't held up by
 * inserting ~30,000 inventory rows per store.
 */
export const stockNewStores: Job = {
  name: 'stock-new-stores',
  everyMs: 10 * 60 * 1000,
  lockId: 7_320_006,
  async run() {
    const { rows } = await pool.query(
      `SELECT s.id, s.name FROM stores s
        WHERE s.is_active
          AND EXISTS (SELECT 1 FROM products)
          AND NOT EXISTS (SELECT 1 FROM store_inventory si WHERE si.store_id = s.id)
        ORDER BY s.id`,
    );
    for (const s of rows) {
      const { rows: r } = await pool.query('SELECT stock_store($1) AS n', [s.id]);
      await openSlots(pool, Number(s.id));
      await bumpCatalogVersion(Number(s.id));
      console.log(`[job stock-new-stores] ${s.name}: ${r[0].n} products`);
    }
    return rows.length ? `stocked ${rows.length} new stores` : undefined;
  },
};

// Jobs from other modules register here too
import { sendOutbox } from './notifications/outbox.js';
import { expireUnpaidOrders, processRefunds } from './modules/payments/service.js';

export const ALL_JOBS: Job[] = [
  cleanupIdempotencyKeys, stockNewStores, keepSlotsOpen, sendOutbox, expireUnpaidOrders, processRefunds,
];
