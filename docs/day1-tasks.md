# Day 1 — your tasks

Do these in order. Write your answers in `docs/notes.md` (in your own words — no copying).
When you finish, push and tell Claude: **"Day 1 done, review"**.

---

## Task 1 — Get it running (30 min)

Follow "Run it locally" in the README, steps 1–4.
Done when `http://localhost:4000/api/health` shows `{"ok":true}` in your browser.

Then run the tests (README, "Run the tests"). Done when you see `8 passed`.

---

## Task 2 — Four Docker experiments (1 hour)

Run each one. After each, write 1–2 sentences: what happened, and why.

**2a. Image vs container**
```bash
docker image ls
docker ps
```
How many `postgres` images are there? How many running containers? What's the difference?

**2b. Volumes keep data alive**
```bash
docker compose exec db psql -U quickkart -d quickkart -c "CREATE TABLE t (x int); INSERT INTO t VALUES (1);"
docker compose down
docker compose up -d db
docker compose exec db psql -U quickkart -d quickkart -c "SELECT * FROM t;"
```
Is the row still there? Why — the container was deleted?

Now (this wipes the database — fine, you'll reload it):
```bash
docker compose down -v
docker compose up -d db
docker compose exec db psql -U quickkart -d quickkart -c "SELECT * FROM t;"
```
What changed? What does `-v` do?
Reload the sample data afterwards (README step 3).

**2c. Ports**
In `docker-compose.yml`, change `"5432:5432"` to `"5544:5432"`. Run `docker compose up -d db`.
Does `npm run dev` still connect? Fix it by changing the port in `api/.env`.
Which number is your laptop's door, and which is inside the container? Change it back when done.

**2d. Environment variables**
```bash
docker compose exec db env
```
Find the `POSTGRES_` lines. Where did those values come from? (Hint: open `.env`.)

**Question to answer:** From your laptop the database is at `localhost:5432`. When the API runs
inside Docker (Day 6), it will use `db:5432`. Why not `localhost`?

---

## Task 3 — Understand the schema (45 min)

Open `db/init/001_schema.sql` and read every line. Then answer:

1. Why do price and stock live in `store_inventory` and not in `products`?
2. Why is money stored as `price_paise INTEGER` instead of a decimal number of rupees?
3. What does `CHECK (stock >= 0)` protect against, even if our code has a bug?
4. Why does `order_items` copy `unit_price_paise` instead of looking up the current price?
5. What is the primary key of `store_inventory`, and why two columns?

---

## Task 4 — Write six SQL queries yourself (2 hours)

Open the database:
```bash
docker compose exec db psql -U quickkart -d quickkart
```
Useful psql commands: `\dt` (list tables), `\d store_inventory` (describe a table), `\q` (quit).

Write each query in `docs/sql-practice.sql`, run it, and check the result looks sensible.
Prices are in paise — divide by 100.0 to show rupees.

1. 20 products sold in store 1, with their category name and price in rupees.
   *(Join store_inventory → products → categories.)*
2. For each store: how many products it stocks, and the average price in rupees.
   *(GROUP BY, COUNT, AVG.)*
3. 20 products that store 2 does **not** stock.
   *(LEFT JOIN … WHERE … IS NULL, or NOT EXISTS.)*
4. For each store and each category: how many items are out of stock (stock = 0).
   *(GROUP BY two columns.)*
5. Categories where store 1's average price is above ₹300.
   *(HAVING.)*
6. Store 1's delivery slots for tomorrow, with free capacity (capacity − booked).
   *(Filter on starts_at with date arithmetic, e.g. `now()::date + 1`.)*

Stuck for 25 minutes? Ask Claude for "hint 1" on that question number.

---

## Task 5 — Read the login code (45 min)

Read, in this order:
`api/src/config.ts` → `api/src/db.ts` → `api/src/errors.ts` → `api/src/middleware/auth.ts`
→ `api/src/modules/auth/routes.ts` → `api/test/auth.test.ts`

Be ready to explain:
1. Why passwords are hashed (not encrypted), and what the salt is for.
2. What is inside the session cookie, and why a user can't change their role to admin.
3. What `httpOnly` and `sameSite: 'lax'` on the cookie protect against.
4. The difference between a 401 and a 403.
5. Why login returns the same error for a wrong email and a wrong password.
6. Why `withTransaction` borrows one client instead of calling `pool.query('BEGIN')`.
7. Why values go into SQL as `$1, $2` instead of being glued into the string.

Claude will quiz you on these.

---

## Task 6 — Push your work

```bash
git add .
git commit -m "day 1: docker experiments, schema notes, sql practice"
git push
```
