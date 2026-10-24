import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './cache.js';

const server = buildApp().listen(config.PORT, () => {
  console.log(`QuickKart API listening on http://localhost:${config.PORT}`);
  console.log(`Redis cache: ${config.REDIS_URL ? 'on' : 'off'}`);
});

// `docker compose stop` sends SIGTERM. Finish in-flight requests, close the
// database pool and Redis cleanly, then exit (instead of being killed mid-order).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end().catch(() => {});
      redis?.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // don't hang forever
  });
}
