# Day 2 — product search

New today: `GET /api/stores`, `/api/categories`, `/api/stores/:id/slots`,
and product search with filters + pagination at `/api/stores/:id/products`.

Run every terminal command from the **quickkart** folder (prompt ends in `quickkart %`)
unless it says `cd api`.

---

## Task 1 — Run the tests (5 min)

The API restarts by itself when files change. In the zsh tab:
```bash
cd api
npm test
cd ..
```
Done when you see **19 passed** (8 from Day 1 + 11 new catalog tests).

If you see `ECONNREFUSED ... 5433`, the test database is stopped. Start it, then re-run:
```bash
docker compose --profile test up -d db-test
```

---

## Task 2 — Try the API in your browser (10 min)

Open each link and look at the result:

1. http://localhost:4000/api/stores — the 3 stores
2. http://localhost:4000/api/categories — the 5 categories
3. http://localhost:4000/api/stores/1/slots — next delivery slots with free places
4. http://localhost:4000/api/stores/1/products — first 20 products, A to Z
5. http://localhost:4000/api/stores/1/products?q=paneer — search
6. http://localhost:4000/api/stores/1/products?q=paneer&category=dairy — search + filter
7. http://localhost:4000/api/stores/1/products?limit=3 — copy the `nextCursor` value, then open
   `http://localhost:4000/api/stores/1/products?limit=3&cursor=PASTE_IT_HERE` — the next 3
8. http://localhost:4000/api/stores/99/products — 404, no such store
9. http://localhost:4000/api/stores/1/products?limit=500 — 400, limit too big

Notice: product 1 can have a different price in store 1 and store 2. That is the
`store_inventory` table at work.

---

## Task 3 — Measure, add the index, measure again (20 min)

This is the "slow product search" engineering challenge.

**Step 1 — Measure WITHOUT the index:**
```bash
docker compose exec -T db psql -U quickkart -d quickkart < db/queries/search-explain.sql
```
For each of the two searches, find and note:
- the line `Seq Scan on products` — PostgreSQL read all 50,000 products
- the `Execution Time` at the bottom of the plan

**Step 2 — Add the index:**
```bash
docker compose exec -T db psql -U quickkart -d quickkart < db/init/003_search_index.sql
```
You should see `CREATE INDEX` and `ANALYZE`.

**Step 3 — Measure AGAIN** (same command as step 1). Now look for
`Bitmap Index Scan on idx_products_name_trgm` and the new `Execution Time`.

**Step 4 — Record your numbers** in `docs/notes.md`. Add this at the bottom and fill in the blanks:

```
## Day 2

### Search measurements (store 1, 50,000 products)
| Search | Without index | With trigram index |
|---|---|---|
| "4242" (about 15 matches) | ___ ms, Seq Scan | ___ ms, Bitmap Index Scan |
| "milk" (about 5,000 matches) | ___ ms, Seq Scan | ___ ms |

### What I learned
- A normal B-tree index can't help `ILIKE '%term%'` because the term can start anywhere
  in the name. A trigram index splits names into 3-letter pieces, so PostgreSQL can find
  names containing the term without reading every row.
- The index helped "4242" hugely because it is selective (few matches). It helped "milk"
  much less: with about 5,000 matches, most of the time goes to fetching and sorting those
  rows, which no index avoids. An index pays off when a query keeps a small fraction of rows.
- Indexes are not free: they use disk space and slow down every INSERT and UPDATE,
  so you add them for queries you actually run, after measuring.
- Search needs at least 3 characters for the trigram index to help.

### Keyset (cursor) pagination
- OFFSET pagination makes the database read and discard all earlier rows, so deep pages
  get slower, and items shift if new products are added while scrolling.
- Keyset pagination remembers the last row seen (name, id) and asks for rows after it,
  so page 500 costs the same as page 1 and there are no duplicates. `id` breaks ties
  between products with the same name. Trade-off: you can't jump to "page 37", only "next".
```

Note: exact times change every run (the first run is often slower because data is not
yet in memory). Run it twice and use the second result.

---

## Task 4 — Push

```bash
git add .
git commit -m "Day 2: catalog search, filters, keyset pagination, trigram index"
git push
```

Then tell Claude **"Day 2 done"**.

---

## Know how to explain (interview prep)

Open `api/src/modules/catalog/routes.ts`. Be ready to explain in one sentence each:
1. Why every search value goes in as `$1, $2` — never glued into the SQL string (SQL injection).
2. Why `%` and `_` in the search text are escaped (they are LIKE wildcards).
3. Why the query fetches `limit + 1` rows (to know whether a next page exists).
4. Why customers see `in_stock` but not the exact stock number (commercially sensitive,
   changes every second, customers only need yes/no).
