import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './cache.js';
import { migrate } from './migrate.js';
import { ALL_JOBS, startJobs } from './jobs.js';
import { startLive, stopLive } from './live.js';
import { seedIfEmpty } from './seed.js';

if (config.MIGRATE_ON_START) await migrate(pool);
await startLive(); // LISTEN for stock/slot/order changes to push to browsers
if (config.ADMIN_EMAILS.length) {
  await pool.query(`UPDATE users SET role = 'admin', store_id = NULL WHERE email = ANY($1) AND role <> 'admin'`, [
    config.ADMIN_EMAILS,
  ]);
}

const server = buildApp().listen(config.PORT, () => {
  console.log(`QuickKart API listening on http://localhost:${config.PORT}`);
  console.log(`Redis cache: ${config.REDIS_URL ? 'on' : 'off'}`);
});

// Fresh deploy? Load the sample shop in the background (the server already answers
// health checks, so the host doesn't think the deploy is stuck while it loads).
if (config.SEED_ON_EMPTY) {
  seedIfEmpty(pool, config.SEED_FILE).catch((e) => console.error('seed failed:', e.message));
}

const stopJobs = startJobs(ALL_JOBS);

// `docker compose stop` sends SIGTERM. Finish in-flight requests, close the
// database pool and Redis cleanly, then exit (instead of being killed mid-order).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    stopJobs();
    void stopLive();
    server.closeAllConnections?.(); // live streams never end on their own
    server.close(async () => {
      await pool.end().catch(() => {});
      redis?.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // don't hang forever
  });
}
