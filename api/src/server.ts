import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './cache.js';
import { migrate } from './migrate.js';
import { ALL_JOBS, startJobs } from './jobs.js';
import { startLive, stopLive } from './live.js';

if (config.MIGRATE_ON_START) await migrate(pool);
await startLive(); // LISTEN for stock/slot/order changes to push to browsers

const server = buildApp().listen(config.PORT, () => {
  console.log(`QuickKart API listening on http://localhost:${config.PORT}`);
  console.log(`Redis cache: ${config.REDIS_URL ? 'on' : 'off'}`);
});

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
