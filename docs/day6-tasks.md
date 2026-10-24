# Day 6 — Docker for everything, load testing, Redis

New today:
- **The whole system in Docker**: PostgreSQL, Redis, the API and nginx (which serves the
  website) start with ONE command. Shop at **http://localhost:8080**.
- **Redis cache** for product browsing and search, with safe fallback if Redis is down.
- **k6 load tests**: shoppers browsing, and a flash sale on one product.

Your `npm run dev` setup (ports 4000 and 5173) keeps working too. Both use the same database.

---

## Task 1 — Update the API's packages (2 min)

The API now uses Redis (the `ioredis` package). In the **zsh** tab:
```bash
cd api
npm install
cd ..
```
Then restart the API in the **node api** tab: **Ctrl+C**, `npm run dev`.
You'll see a new line: `Redis cache: off` (normal: `npm run dev` runs without Redis).

## Task 2 — Start everything with Docker (5–10 min the first time)

In the **zsh** tab, from the `quickkart` folder:
```bash
docker compose up -d --build
```
The first time it downloads Node, nginx and Redis and builds two images. Later runs take seconds.
Then check:
```bash
docker compose ps
```
You want `db`, `redis`, `api` and `web` all **running**, and `(healthy)` for db, redis and api.
Open **http://localhost:8080**: the same shop, now served by nginx in Docker.
Your account works here too (same database).

If something isn't healthy, look at its logs and send Claude a screenshot:
```bash
docker compose logs api --tail 50
docker compose logs web --tail 50
```

## Task 3 — See the cache work (2 min)

Run this **twice**:
```bash
curl -s -D - -o /dev/null "http://localhost:8080/api/stores/1/products?q=paneer" | grep -i x-cache
```
First `X-Cache: MISS` (came from PostgreSQL), then `X-Cache: HIT` (came from Redis).
In the browser you can see the same header: open developer tools (Cmd+Option+I) →
Network → click a `products` request → Response Headers.

## Task 4 — Load tests (15 min)

Each test runs about a minute and prints a summary. Copy the numbers into
`docs/performance.md` (it explains which lines to read).

**A. Catalog with the cache ON**
```bash
bash scripts/load-test.sh catalog
```

**B. Catalog with the cache OFF**: restart the API without Redis, test, turn it back on:
```bash
REDIS_URL= docker compose up -d api
bash scripts/load-test.sh catalog
docker compose up -d api
```
(`REDIS_URL=` with nothing after it means "empty" just for that one command.)

**C. Flash sale: 20 orders per second on one product**
```bash
bash scripts/load-test.sh checkout
```

**D. Flash sale at 50 orders per second**
```bash
bash scripts/load-test.sh checkout 50
```

**E. (Optional) Three API containers, cache off**
```bash
REDIS_URL= docker compose up -d --scale api=3 api
bash scripts/load-test.sh catalog
docker compose up -d --scale api=1 api
```
nginx spreads requests across all three. Does it help? Compare with B and think about
where the bottleneck is (API CPU, or the database?).

## Task 5 — Prove it's reproducible (3 min)

```bash
docker compose down
docker compose up -d
```
`down` deletes the containers. `up` creates new ones from the same images. Your products,
accounts and orders are still there because PostgreSQL's data lives in the `pgdata` volume.
(`docker compose down -v` would delete the volume too. Don't, unless you want a clean start.)

## Task 6 — Push

```bash
git add .
git commit -m "Day 6: Docker stack, Redis cache, k6 load tests"
git push
```
Then tell Claude **"Day 6 done"**. Day 7 is the README, architecture diagram, scaling
document and a mock interview.

---

## Know how to explain

**Dockerfile, multi-stage.** Stage 1 has TypeScript and dev tools and compiles the code.
Stage 2 copies only the compiled output and production packages: smaller and safer.
The website's final image has no Node.js at all, just nginx and static files.

**Layer caching.** `COPY package*.json` and `npm ci` come BEFORE copying the source, so
editing code doesn't reinstall every package on the next build.

**Service names.** Inside Compose the API reaches `db:5432` and `redis:6379`; nginx reaches
`api:4000`. Only nginx (8080) is public. The API has no published port at all.

**Health checks + depends_on.** The API starts only after PostgreSQL and Redis say they're
ready; nginx only after the API's `/api/health` answers.

**Stateless API → horizontal scaling.** The login lives in a cookie, not in the API's
memory, so any API container can serve any request. That's why `--scale api=3` just works.

**Cache-aside + versioned keys.** Read Redis first; on a miss, query PostgreSQL and store
the result for 30 s. An admin edit bumps the store's version number, making all its old
keys unused at once. If Redis fails, requests go to the database: slower, never broken.
What's never cached: stock/prices used by checkout, slot capacity, anyone's orders.

**Open vs closed load model.** The checkout test sends orders at a fixed rate whatever
happens (like real customers). A closed test with N users waiting for replies slows itself
down when the server slows, and hides the problem.

**Little's Law**: requests in the system = arrival rate × time each spends.
50 req/s × 0.2 s = 10 requests in flight. With a pool of 10 database connections,
anything slower than 0.2 s means requests start queueing for a connection.

**Hot-row contention.** In a flash sale every order locks the same stock row and slot row,
so orders go through one at a time. Adding API containers doesn't help; the fix is in the
data design (Day 7 scaling doc).
