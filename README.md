# QuickKart

A scalable, multi-store quick-commerce platform inspired by Blinkit.

**Stack:** React + TypeScript · Node.js 24 + Express 5 · PostgreSQL 18 · Docker Compose · Redis · k6

> Work in progress — this README grows as the project does.

## Run it with Docker (one command)

You need Docker Desktop and Git.

```bash
cp .env.example .env
docker compose up -d --build     # PostgreSQL, Redis, API, nginx
docker compose exec -T db psql -U quickkart -d quickkart < db/seed/seed.sql   # sample data, once
```
Open **http://localhost:8080**. Run several API copies behind nginx with
`docker compose up -d --scale api=3`.

| Service | What it is | Reachable at |
|---|---|---|
| web | nginx: serves the React app, forwards `/api` to the API | http://localhost:8080 |
| api | Express API (stateless, can be scaled) | only through nginx |
| db | PostgreSQL 18, data in the `pgdata` volume | localhost:5432 (for tools) |
| redis | cache for catalog reads | only inside Docker |
| k6 | load tester, on demand | `bash scripts/load-test.sh catalog` |

## Run it for development (live reload)

You need Node.js 24, Docker Desktop and Git.

```bash
# 1. Configuration
cp .env.example .env
cp api/.env.example api/.env

# 2. Database (first start creates the tables automatically)
docker compose up -d db
docker compose ps          # wait for "healthy"

# 3. Sample data: 3 stores, 50,000 products, delivery slots
#    macOS / Linux / Git Bash:
docker compose exec -T db psql -U quickkart -d quickkart < db/seed/seed.sql
#    Windows PowerShell:
#    Get-Content db/seed/seed.sql | docker compose exec -T db psql -U quickkart -d quickkart

# 4. API (leave running)
cd api
npm install
npm run dev                # http://localhost:4000/api/health

# 5. Website (in a second terminal, leave running)
cd web
npm install
npm run dev                # open http://localhost:5173
```

To use the admin area, register on the website, then
`bash scripts/make-admin.sh your-email@example.com` and log in again.
To wipe all data and reload the samples: `bash scripts/reset-data.sh`.

## Run the tests

```bash
docker compose --profile test up -d db-test   # separate, throwaway test database
cd api && npm test                            # 60 API tests (+5 Redis tests, see below)
cd ../web && npm test                         # cart logic tests
```
The Redis cache tests run when a Redis is available:
`docker run --rm -d -p 6380:6379 redis:8-alpine` then `TEST_REDIS_URL=redis://localhost:6380 npm test`.

## Performance

Load tests use k6 through nginx (`bash scripts/load-test.sh catalog | checkout`).
Results and what they mean: [docs/performance.md](docs/performance.md).

| Search, 50 concurrent users | Without cache | With Redis |
|---|---|---|
| "paneer" (~750 matches) | 155 req/s, p50 295 ms | 3,061 req/s, p50 13 ms |
| "4242" (15 matches) | 1,239 req/s, p50 38 ms | 3,677 req/s, p50 12 ms |

Measured during development with autocannon; see docs/performance.md for k6 results.

### See the race condition

```bash
cd api && npm run demo:race
```
```
NAIVE: 10 buyers, 1 in stock -> 10 orders created, stock now 0   <-- OVERSOLD by 9
REAL:  10 buyers, 1 in stock -> 1 order created, 9 told "out of stock", stock now 0   <-- CORRECT
```

## Project structure

```
db/init/        schema + indexes (applied automatically to a fresh database)
db/seed/        sample data (run manually, step 3 above)
db/queries/     measurement scripts (EXPLAIN ANALYZE), add-slots.sql
scripts/        load-test.sh: run k6 against the Docker stack
                try-checkout.sh, try-day4.sh: exercise the running API
                reset-data.sh: wipe all data and reload the samples
                make-admin.sh: promote a user to admin (no API for this, on purpose)
api/src/        Express API
  config.ts     environment variables, validated at start-up
  db.ts         connection pool + withTransaction helper
  errors.ts     HttpError + central error handler
  middleware/   requireAuth, requireRole
  modules/      one folder per feature (auth, catalog, orders, admin)
  cache.ts      Redis cache-aside (optional; falls back to PostgreSQL)
api/test/       automated tests (Vitest + Supertest)
web/src/        React + TypeScript website (Vite, React Router, TanStack Query)
  api/          fetch wrapper + response types
  features/     auth, store picker, cart (reducer + context + drawer)
  pages/        shop, login/register, checkout, orders, admin/
  components/   header, delivery band, product tile, loading/error/empty states
load/           k6 load tests (catalog browsing, checkout flash sale)
docs/           task sheets, notes, performance results
```

## API so far

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| GET | /api/health | – | 200 | 500 |
| POST | /api/auth/register | – | 201 | 400, 409 |
| POST | /api/auth/login | – | 200 | 400, 401 |
| POST | /api/auth/logout | user | 204 | 401 |
| GET | /api/auth/me | user | 200 | 401 |
| GET | /api/stores | – | 200 | |
| GET | /api/categories | – | 200 | |
| GET | /api/stores/:storeId/slots | – | 200 | 400, 404 |
| GET | /api/stores/:storeId/products?q=&category=&limit=&cursor= | – | 200 | 400, 404 |
| POST | /api/orders (header `Idempotency-Key`) | user | 201 | 400, 401, 409, 422 |
| GET | /api/orders | user | 200 | 401 |
| GET | /api/orders/:id | owner | 200 | 401, 404 |
| POST | /api/orders/:id/cancel | owner | 200 | 401, 404, 409 |
| GET | /api/admin/stores/:storeId/inventory | admin | 200 | 401, 403, 404 |
| PATCH | /api/admin/stores/:storeId/inventory/:productId | admin | 200 | 400, 403, 404, 409 |
| POST | /api/admin/stores/:storeId/slots | admin | 201 | 400, 403, 409 |
| GET | /api/admin/orders, /api/admin/orders/:id | admin | 200 | 401, 403, 404 |
| PATCH | /api/admin/orders/:id/status | admin | 200 | 400, 403, 404, 409 |
| GET | /api/admin/reports/sales, /top-products, /slots | admin | 200 | 400, 403 |

## Engineering challenges

| Challenge | Solution | Status |
|---|---|---|
| Last item purchased twice | Atomic conditional `UPDATE ... WHERE stock >= qty` in one transaction | ✅ |
| Same product in different stores | `store_inventory` junction table | ✅ |
| Duplicate checkout requests | Idempotency keys, stored in the same transaction as the order | ✅ |
| Too many delivery bookings | Atomic `UPDATE ... WHERE booked < capacity` | ✅ |
| Slow product search | Trigram index + keyset pagination (measured with EXPLAIN ANALYZE) | ✅ |
| Setup differs between machines | Docker Compose: one command, healthchecks, volumes | ✅ |
| Slow repeated reads | Redis cache-aside with versioned keys; checkout never reads the cache | ✅ |
