import { Redis } from 'ioredis';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Cache-aside with Redis, used ONLY for catalog reads (product search/browse).
//
//   1. look in Redis  -> HIT: return it, the database isn't touched
//   2. MISS: run the real query, store the result with a TTL, return it
//
// Why this is safe: checkout NEVER reads the cache. It re-reads price and stock
// from PostgreSQL inside its transaction. So the cache can make the shop page
// a few seconds stale, but it can never make an order oversell or charge a
// wrong price. Never cache stock/prices used by checkout, slot capacity, or
// per-user data like order history.
//
// Why it's optional: if Redis is missing, slow or down, every function here
// quietly falls back to the database. The site gets slower, never broken.
// ---------------------------------------------------------------------------

export const redis = config.REDIS_URL
  ? new Redis(config.REDIS_URL, {
      enableOfflineQueue: false, // Redis down? fail at once instead of queueing requests
      maxRetriesPerRequest: 1,
      commandTimeout: 250, // a slow cache is worse than no cache
      connectTimeout: 2000,
    })
  : null;

redis?.on('error', () => {
  /* errors are handled per call (fallback to the database); avoid log spam */
});

export type CacheStatus = 'HIT' | 'MISS' | 'OFF';

/** Returns the cached value for `key`, or runs `load`, stores it for `ttl` seconds and returns it. */
export async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttl = config.CACHE_TTL_SECONDS,
): Promise<{ value: T; status: CacheStatus }> {
  if (!redis || redis.status !== 'ready') return { value: await load(), status: 'OFF' };
  try {
    const hit = await redis.get(key);
    if (hit !== null) return { value: JSON.parse(hit) as T, status: 'HIT' };
  } catch {
    return { value: await load(), status: 'OFF' };
  }
  const value = await load();
  // Don't make the user wait for the write; a failed write just means a later MISS
  redis.set(key, JSON.stringify(value), 'EX', ttl).catch(() => {});
  return { value, status: 'MISS' };
}

/**
 * Invalidation by VERSION. Every catalog key includes the store's version
 * number: catalog:1:v7:{...}. When an admin changes a price or hides a product,
 * we bump the version to v8, so every old key for that store is instantly unused
 * (and expires by itself). One INCR instead of finding and deleting thousands of keys.
 */
export async function catalogVersion(storeId: number): Promise<string> {
  if (!redis || redis.status !== 'ready') return '0';
  try {
    return (await redis.get(`catalog:ver:${storeId}`)) ?? '0';
  } catch {
    return '0';
  }
}

export async function bumpCatalogVersion(storeId: number): Promise<void> {
  if (!redis || redis.status !== 'ready') return;
  await redis.incr(`catalog:ver:${storeId}`).catch(() => {});
}
