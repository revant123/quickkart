# Performance results

How QuickKart behaves under load, and what changed when. Fill in your own numbers
from Day 6 (k6 through Docker). Change ONE thing per experiment.

## How to read k6 output

| k6 line | Meaning |
|---|---|
| `http_reqs ... /s` | **Throughput**: requests handled per second |
| `http_req_duration ... p(95)=` | **Latency**: 95% of requests were faster than this |
| `http_req_failed` | Share of requests that failed (want 0%) |
| `checks` | Share of responses that were what we expected (want 100%) |
| `✓` / `✗` next to thresholds | Did the test meet its goal (p95 < 300 ms etc.)? |

Why p95 and not the average: if 95 requests take 50 ms and 5 take 2 seconds, the average
(~150 ms) describes nobody. p95 tells you what the slowest 1 in 20 customers experience.

## My results (k6 through Docker on my laptop)

| # | Experiment | Load | Throughput (req/s) | p95 latency | Errors | What I noticed |
|---|---|---|---|---|---|---|
| A | Catalog, cache **ON** | 50 shoppers | 39.6 | 7.65 ms | 0% | All checks passed. Fastest. |
| B | Catalog, cache **OFF** | 50 shoppers | 39.5 | 14.12 ms | 0% | Same throughput (test sends the same traffic), p95 about 2x slower without the cache. |
| C | Checkout, one product (flash sale) | 20 orders/s | 20.0 orders/s | 16.21 ms | 0% | 901 of 901 orders placed, no oversell. |
| D | Checkout, one product | 50 orders/s | 50.0 orders/s | 45.62 ms | 0% | 2,250 of 2,250 placed. 2.5x the load gave 2.8x the p95: orders queue for the same stock and slot row locks (hot-row contention). p90 was 7.7 ms; worst request 2.7 s, likely during the start-up burst of 50 registrations. |
| E | Catalog, cache OFF, **3 API containers** (optional) | 50 shoppers | | | | Not run |

## Reference: measured during development (autocannon, 50 connections, no Docker)

These show the pattern you should expect. Absolute numbers depend on the machine.

| Request | Cache off | Cache on (Redis) | Change |
|---|---|---|---|
| Search "paneer" (~750 matches in a store) | 155 req/s, p50 295 ms, p99 860 ms | 3,061 req/s, p50 13 ms, p99 42 ms | ~20x throughput |
| Search "4242" (15 matches) | 1,239 req/s, p50 38 ms | 3,677 req/s, p50 12 ms | ~3x |
| Search "paneer", cache + **fresh stock** (Batch A) | 155 req/s | 1,528 req/s, p50 28 ms | ~10x, and stock is never stale |
| Browse (no search) | 1,501 req/s, p50 32 ms | 3,446 req/s, p50 13 ms | ~2.3x |

### What these numbers mean
- **Popular searches are the slow part.** The trigram index (Day 2) finds "paneer" quickly,
  but PostgreSQL must still sort ~750 matches A to Z on every request. Rare searches like
  "4242" are already fast, so the cache helps them less. Caching pays off most exactly
  where the database does the most repeated work.
- **Freshness vs speed (Batch A):** originally the cached pages could show stock up to
  30 seconds old. Now only the search result list is cached, and stock and price for the
  page are read fresh with one primary-key lookup. That halves the cached throughput
  (3,061 to 1,528 req/s for "paneer") but it's still about 10x faster than no cache, and
  shoppers never see stale stock. Checkout never reads the cache in any version.
- **Flash sale (C, D):** every order updates the SAME stock row and the SAME slot row, so
  orders queue for those row locks one after another. That is "hot-row contention".
  More API containers can't help: the limit is one row in the database, not the API.
  Fixes are in `docs/scaling.md` (Day 7).
