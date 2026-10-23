import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { errorHandler } from './errors.js';
import { authRouter } from './modules/auth/routes.js';

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
  // Day 2+: catalog, orders and admin routers get mounted here

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler); // must be registered last
  return app;
}
