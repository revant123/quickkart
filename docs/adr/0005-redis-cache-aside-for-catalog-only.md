# ADR 0005: Redis cache-aside for catalog reads only

**Status:** accepted

## Context
Catalog browsing and search are read-heavy and repeat often. Measurements showed popular
searches are the expensive reads: "paneer" matches ~750 products in a store, and PostgreSQL
sorts them on every request (155 req/s, p50 295 ms under 50 concurrent users). Rare searches
are already fast thanks to the trigram index.

## Decision
Cache-aside in Redis for `GET /api/stores/:id/products` only:
- key = store + catalog version + every query parameter; TTL 30 seconds;
- admin edits (price, stock, listing) increment the store's version, so all its old keys
  stop being used at once;
- Redis errors, timeouts (250 ms) or absence fall back to PostgreSQL; `X-Cache: HIT/MISS/OFF`
  shows what happened.

## Consequences
- **Good:** "paneer" went from 155 to 3,061 req/s (p50 295 → 13 ms) in development
  measurements; under the k6 browse test p95 fell from 14.1 ms to 7.7 ms.
- **Update (Batch A): no more stale stock.** The cache now holds only the expensive part
  (search, filter, sort). Price and stock for the ~24 products on the page are read fresh
  with one primary-key lookup, and live updates push changes to open pages. Measured cost:
  "paneer" serves 1,528 req/s instead of 3,061 cache-only, still ~10x the 155 without a
  cache. Checkout never reads the cache either way (`api/test/cache.test.ts`).
- **Never cached:** stock and prices used by checkout, slot capacity, order history,
  anything per user.
- **Cost:** another service to run; invalidation logic to maintain.
- **Alternatives considered:** no cache (fine at low load: B in performance.md);
  a materialised search table; a CDN cache for anonymous catalog responses (later).
