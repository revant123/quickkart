import type { RequestHandler } from 'express';
import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../cache.js';

// ---------------------------------------------------------------------------
// Rate limiting: how many requests one client may make in a time window.
// Protects against password guessing, sign-up spam and checkout abuse.
//
// Counts live in Redis when it's available, so ALL API containers share one
// count (otherwise 3 containers would allow 3x the limit). If Redis is down,
// requests are let through rather than blocking real customers
// (passOnStoreError): availability over strictness.
//
// Over the limit: 429 Too Many Requests, with standard RateLimit-* headers
// telling the client when to try again.
// ---------------------------------------------------------------------------

export type RateLimits = { authPer15Min: number; checkoutPerMin: number; apiPerMin: number };

export const DEFAULT_LIMITS: RateLimits = {
  authPer15Min: 30, // login / register / password reset attempts per IP
  checkoutPerMin: 60, // orders per logged-in user
  apiPerMin: 1200, // everything else, per IP
};

function makeStore(prefix: string): Options['store'] | undefined {
  if (!redis) return undefined; // in-memory store: fine for a single instance
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis!.call(args[0], ...args.slice(1)) as never,
  });
}

const tooMany: Options['handler'] = (_req, res, _next, options) => {
  res.status(options.statusCode).json({ error: 'rate_limited' });
};

const base = { standardHeaders: 'draft-8', legacyHeaders: false, passOnStoreError: true, handler: tooMany } as const;

export function createLimiters(limits: RateLimits) {
  const auth = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    limit: limits.authPer15Min,
    store: makeStore('auth'),
  });
  const checkout = rateLimit({
    ...base,
    windowMs: 60 * 1000,
    limit: limits.checkoutPerMin,
    // per user when logged in (runs after requireAuth), else per IP
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? '')),
    store: makeStore('checkout'),
  });
  const api = rateLimit({
    ...base,
    windowMs: 60 * 1000,
    limit: limits.apiPerMin,
    store: makeStore('api'),
  });
  return { auth, checkout, api };
}

/** Pass-through used when rate limiting is switched off (tests, load tests). */
export const noLimit: RequestHandler = (_req, _res, next) => next();
