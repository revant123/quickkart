# How QuickKart would scale

The approach: **measure, find the bottleneck, apply the cheapest fix that removes it, measure
again.** Below are the bottlenecks in the order they would appear as traffic grows, with
evidence from this project's own load tests ([performance.md](performance.md)) where we have it.

## Where we are today

| Measured (k6 through nginx, Docker on a laptop) | Result |
|---|---|
| 50 shoppers browsing and searching, cache on | 39.6 req/s, p95 7.7 ms, 0 errors |
| Same, cache off | 39.5 req/s, p95 14.1 ms, 0 errors |
| Flash sale, one product, 20 orders/s | 901/901 placed, p95 16.2 ms |
| Flash sale, one product, 50 orders/s | 2,250/2,250 placed, p95 45.6 ms, no oversell |
| Search "paneer", 50 concurrent connections (autocannon) | 155 req/s without cache, 3,061 req/s with Redis |

One API container, one PostgreSQL, one Redis. Nothing is close to failing at these loads.

## The bottlenecks, in order

### 1. One API process uses one CPU core
**Symptom:** API container CPU near 100% while PostgreSQL is idle (`docker stats`).
**Fix:** run more API containers: `docker compose up -d --scale api=3`. nginx already
spreads requests across them.
**Why it works here:** the API is stateless (login in a cookie, no in-memory sessions).
**Trade-off:** each container has its own connection pool (see 2).

### 2. Too many database connections
**Symptom:** errors like "too many clients", or requests waiting for a pool connection.
**Why:** API containers × `DB_POOL_MAX` must stay under PostgreSQL's `max_connections` (100).
**Little's Law:** requests in flight = arrival rate × time each takes. 500 req/s × 20 ms =
10 queries in flight, which fits a pool of 10. If queries slow to 100 ms, 50 are in flight
and requests start queueing.
**Fix:** size pools deliberately; add **PgBouncer** in transaction mode between the API and
PostgreSQL so thousands of client connections share a few dozen database connections.
**Trade-off:** transaction pooling forbids session-level features (session settings,
advisory locks held across transactions). This code base doesn't use them.

### 3. Repeated expensive reads
**Evidence:** popular searches sort hundreds of matches every time (155 req/s for "paneer").
**Fixes, cheapest first:** the trigram index (done, Day 2) → Redis cache-aside (done,
20× on "paneer") → a CDN in front of anonymous catalog responses and product images.
**Trade-off:** staleness (30 s TTL) and invalidation logic. Safe because checkout never
reads a cache.

### 4. Read load on the primary database
**Symptom:** the primary's CPU is busy with SELECTs; writes slow down.
**Fix:** **read replicas** for catalog pages, order history and admin reports.
**Trade-off:** replication lag. A customer might not see an order they placed a moment ago
on a replica, so read "my orders" from the primary right after checkout. **Never** read
stock or slot capacity for checkout from a replica.

### 5. Hot rows during a flash sale (already visible in our numbers)
**Evidence:** going from 20 to 50 orders/s on ONE product raised checkout p95 from 16 ms to
46 ms. Every order locks the same `store_inventory` row and the same `delivery_slots` row,
so orders pass through one at a time. **More API containers cannot help**: the limit is a
single database row.
**Fixes:**
- Keep the transaction as short as possible (it already does no network calls inside).
- **Split hot stock into buckets**: e.g. 10 rows of 100 units instead of 1 row of 1,000;
  each checkout picks a random bucket with stock, so 10 orders can proceed in parallel.
- **Queue orders for the hot product**: accept the request, put it on a queue, process
  sequentially, and confirm asynchronously ("Order received, confirming…").
- Spread delivery slots: more, smaller slots reduce contention on one slot row.
**Trade-off:** more complex code; asynchronous confirmation changes the user experience.

### 6. Slow side effects
**Coming soon:** SMS and email confirmations, payment webhooks, analytics events.
**Rule:** never call a slow external service inside the checkout transaction; its row
locks would be held for the whole call.
**Fix:** after commit, put a job on a queue. Use the **transactional outbox** pattern:
insert an `outbox` row in the same transaction as the order, and a worker publishes it.
The order and "a message must be sent" are then committed together.
**Trade-off:** at-least-once delivery, so consumers must be idempotent (the same idea as
our idempotency keys).

### 7. One database's write capacity
**Symptom:** the primary can't keep up with writes even after the above.
**Fix:** **partition by store or city.** Quick commerce is naturally local: a store's
stock, slots and orders never interact with another store's. Each shard holds a set of
stores; the API routes by `store_id`.
**Trade-off:** cross-store queries (company-wide sales reports) move to a separate
analytics database fed by change-data-capture.

## Why still a monolith?
A single deployable API with clear modules (auth, catalog, orders, admin) is the right
starting point: you rarely know the right service boundaries early, and splitting adds
network failures and distributed transactions to every flow (Fowler, "MonolithFirst").
If one part needs to scale or deploy independently, the module folders are the seams:
the **catalog read path** would be the first candidate to extract, since it is read-heavy,
cacheable and doesn't need the checkout transaction.

## What I'd measure next
- Experiment E: cache off, 3 API containers. Does throughput rise, or is PostgreSQL the limit?
- The flash sale at 100 and 200 orders/s, watching `pg_stat_activity` for lock waits.
- `pg_stat_statements` to rank queries by total time.
