# QuickKart

A scalable, multi-store quick-commerce platform inspired by Blinkit.

**Stack:** React + TypeScript · Node.js 24 + Express 5 · PostgreSQL 18 · Docker Compose · Redis · k6

> Work in progress — this README grows as the project does.

## Run it locally

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

# 4. API
cd api
npm install
npm run dev                # http://localhost:4000/api/health
```

## Run the tests

```bash
docker compose --profile test up -d db-test   # separate, throwaway test database
cd api
npm test
```

## Project structure

```
db/init/        schema + indexes (applied automatically to a fresh database)
db/seed/        sample data (run manually, step 3 above)
db/queries/     measurement scripts (EXPLAIN ANALYZE)
api/src/        Express API
  config.ts     environment variables, validated at start-up
  db.ts         connection pool + withTransaction helper
  errors.ts     HttpError + central error handler
  middleware/   requireAuth, requireRole
  modules/      one folder per feature (auth, catalog, orders, admin)
api/test/       automated tests (Vitest + Supertest)
docs/           task sheets, notes, architecture
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

## Engineering challenges

| Challenge | Solution | Status |
|---|---|---|
| Last item purchased twice | Atomic stock updates in transactions | Day 3 |
| Same product in different stores | `store_inventory` junction table | ✅ schema |
| Duplicate checkout requests | Idempotency keys | Day 3 |
| Too many delivery bookings | Capacity-safe slot reservation | Day 3 |
| Slow product search | Trigram index + keyset pagination (measured with EXPLAIN ANALYZE) | ✅ |
| Setup differs between machines | Docker Compose | ✅ |
