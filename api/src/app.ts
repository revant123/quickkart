import express from 'express';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { config } from './config.js';
import { errorHandler } from './errors.js';
import { authRouter } from './modules/auth/routes.js';
import { catalogRouter } from './modules/catalog/routes.js';
import { createOrdersRouter } from './modules/orders/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { adminImagesRouter, publicImagesRouter } from './modules/images/routes.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { addressesRouter, locationRouter } from './modules/location/routes.js';
import { paymentsRouter, razorpayWebhook } from './modules/payments/routes.js';
import { adminRidersRouter, riderRouter } from './modules/rider/routes.js';
import { createLimiters, DEFAULT_LIMITS, noLimit, type RateLimits } from './middleware/rateLimit.js';

export type AppOptions = {
  /** Rate limits to enforce, or false for none. Default: on, except in tests. */
  rateLimits?: RateLimits | false;
};

/**
 * Builds the Express app WITHOUT starting a server, so tests can send
 * requests to it in memory (see test/). server.ts is what actually listens.
 */
export function buildApp(options: AppOptions = {}) {
  const app = express();

  // Behind nginx (Docker) or Render's proxy: trust ONE proxy hop, so req.ip is
  // the real client address from X-Forwarded-For (needed for per-IP rate limits)
  app.set('trust proxy', config.TRUST_PROXY);

  // The payment webhook needs the RAW body to check its signature, so it's
  // registered before the JSON parser (which would consume and re-shape it).
  app.use('/api/payments/razorpay/webhook', razorpayWebhook);

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const limitsOn = config.RATE_LIMIT_ENABLED && config.NODE_ENV !== 'test';
  const limits = options.rateLimits ?? (limitsOn ? DEFAULT_LIMITS : false);
  const limiter = limits ? createLimiters(limits) : { auth: noLimit, checkout: noLimit, api: noLimit };

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1'); // proves the database is reachable
    res.json({ ok: true });
  });

  app.use('/api', limiter.api);
  app.use(
    ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password',
      '/api/auth/verify-email', '/api/auth/resend-verification'],
    limiter.auth,
  );

  app.use('/api/auth', authRouter);
  app.use('/api', locationRouter); // before catalog: /stores/nearest isn't a store id
  app.use('/api', catalogRouter);
  app.use('/api/me/addresses', addressesRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/rider', requireAuth, requireRole('rider'), riderRouter);
  app.use('/api', publicImagesRouter);
  app.use('/api/orders', createOrdersRouter(limiter.checkout));
  // Every admin route: must be logged in (401) AND be an admin (403)
  app.use('/api/admin', requireAuth, requireRole('admin'), adminRouter, adminImagesRouter, adminRidersRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Deployed as one container: the API also serves the built website, so the shop and
  // the API share one origin (cookies and live updates just work, no CORS).
  if (config.STATIC_DIR) {
    const dir = path.resolve(config.STATIC_DIR);
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, file) {
          // Vite puts a content hash in asset file names, so they can be cached forever
          res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
        },
      }),
    );
    // Any other path is a page of the single-page app: send index.html, never cached
    // (so a new deploy is picked up on the next visit)
    app.get('/{*page}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use(errorHandler); // must be registered last
  return app;
}
