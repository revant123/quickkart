import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { errorHandler } from './errors.js';
import { authRouter } from './modules/auth/routes.js';
import { catalogRouter } from './modules/catalog/routes.js';
import { ordersRouter } from './modules/orders/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { requireAuth, requireRole } from './middleware/auth.js';

/**
 * Builds the Express app WITHOUT starting a server, so tests can send
 * requests to it in memory (see test/). server.ts is what actually listens.
 */
export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1'); // proves the database is reachable
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api', catalogRouter);
  app.use('/api/orders', ordersRouter);
  // Every admin route: must be logged in (401) AND be an admin (403)
  app.use('/api/admin', requireAuth, requireRole('admin'), adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler); // must be registered last
  return app;
}
