# Day 3 — checkout (the heart of the project)

New today: `POST /api/orders` — places an order safely, solving three engineering challenges:

| Challenge | What could go wrong | How QuickKart prevents it |
|---|---|---|
| Last item purchased twice | 10 people buy the last milk; all 10 succeed | Atomic conditional stock UPDATE |
| Too many delivery bookings | A slot for 5 gets 8 orders | Atomic conditional slot UPDATE |
| Duplicate checkout requests | Phone retries after a network drop; customer charged twice | Idempotency key |

Files to read: `api/src/modules/orders/placeOrder.ts` (the real checkout),
`api/src/modules/orders/naiveCheckout.ts` (the broken one, for comparison).

Run commands from the **quickkart** folder unless the step says `cd api`.

---

## Task 1 — Run all the tests (5 min)

```bash
cd api
npm test
cd ..
```
Done when you see **35 passed**.
If you see `ECONNREFUSED ... 5433`: `docker compose --profile test up -d db-test`, then run again.

---

## Task 2 — Watch the bug, then the fix (5 min)

```bash
cd api
npm run demo:race
cd ..
```
You will see something like:
```
NAIVE: 10 buyers, 1 in stock -> 10 orders created, stock now 0   <-- OVERSOLD by 9
REAL:  10 buyers, 1 in stock -> 1 order created, 9 told "out of stock", stock now 0   <-- CORRECT
```
Screenshot this for your README later. It is the single best proof of the project.

---

## Task 3 — Place real orders through the API (5 min)

Make sure the API is running (node tab), then:
```bash
bash scripts/try-checkout.sh
```
It registers a customer, sets one product's stock to exactly 1, and then:
1. buys it → `201 Created`
2. retries the SAME request with the SAME key → `201`, **same orderId**, `Idempotent-Replayed: true`
3. a NEW order for it → `409 out_of_stock`
4. shows stock = `0` (not −1)

If it says "No free delivery slots left":
```bash
docker compose exec -T db psql -U quickkart -d quickkart < db/queries/add-slots.sql
```

---

## Task 4 — Understand it (30 min, worth it)

Open `placeOrder.ts` next to this sheet. It has 5 numbered steps, all inside ONE transaction.

### Why the naive version oversells
Two customers, A and B, stock = 1:

| Time | Customer A | Customer B | Stock |
|---|---|---|---|
| t1 | reads stock → 1 | | 1 |
| t2 | | reads stock → 1 | 1 |
| t3 | 1 ≥ 1, OK | | 1 |
| t4 | | 1 ≥ 1, OK | 1 |
| t5 | writes stock = 0 | | 0 |
| t6 | | writes stock = 0 | 0 |
| t7 | order created | order created | 0 → 2 sold, 1 existed |

Both read the same old value; B's write overwrites A's. This is the **lost update** anomaly.
Stock ends at 0, not −1, so even `CHECK (stock >= 0)` never notices.

### Why the real version can't oversell
```sql
UPDATE store_inventory SET stock = stock - $3
 WHERE store_id = $1 AND product_id = $2 AND stock >= $3
RETURNING price_paise;
```
- The check (`stock >= $3`) is **inside** the write. There is no gap between checking and writing.
- An UPDATE **locks** the row until the transaction ends. B waits for A.
- When A commits, PostgreSQL **re-checks B's WHERE clause on the new value** (stock is now 0),
  so B updates nothing and gets 0 rows → `409 out_of_stock`.
- `stock = stock - 1` is relative to the current value, so updates can't overwrite each other.

The delivery slot uses exactly the same pattern: `booked = booked + 1 WHERE booked < capacity`.

### Why one transaction matters (atomicity)
If the 2nd item in a cart is out of stock, the code throws. `withTransaction` then rolls back
**everything**: the slot booking, stock already taken for the 1st item, and the idempotency key.
Test 6 in `test/checkout.test.ts` proves it.

### Why items are sorted by productId (deadlocks)
Order A locks milk then wants bread; order B locked bread and wants milk → each waits forever
(a **deadlock**). If everyone locks in the same order (lowest productId first, slot always
before products), that circle can't form. `withRetry` handles the rare leftover case.

### How the idempotency key works
- The app creates a random key (UUID) for each order the customer **intends** to place,
  and sends the same key on every retry of that order.
- Step 1 inserts the key. If the same key arrives again, the insert does nothing,
  and we return the **saved response** instead of buying again.
- If two requests with the same key arrive at the **same moment**, the second insert
  **waits** for the first to finish (unique index), then returns its saved response. Test 4.
- Same key + different cart = client bug → `422`. Test 5.
- The key is saved in the same transaction as the order: either both exist or neither does.
- This is the same design Stripe uses for payments.

### Why the price comes from the database
The client sends only product IDs and quantities. Prices are read inside the transaction,
so a tampered app can't send `price: 1`. Test 7.

---

## Task 5 — Add to notes.md and push

Add a `## Day 3` section to `docs/notes.md` with:
- the two lines from Task 2 (NAIVE vs REAL)
- in 2–3 sentences, in your own words: why the naive version oversells and why the
  conditional UPDATE doesn't

```bash
git add .
git commit -m "Day 3: safe checkout - atomic stock, slot capacity, idempotency keys"
git push
```
Then tell Claude **"Day 3 done"**.

---

## Interview questions you can now answer

1. *How do you stop two customers buying the last item?* — Conditional atomic UPDATE; row lock;
   PostgreSQL re-checks the WHERE clause after waiting; test with 10 concurrent requests.
2. *Wouldn't a transaction alone fix it?* — No. At PostgreSQL's default isolation
   (Read Committed) a plain SELECT takes no lock, so both still read stock = 1.
   Alternatives: `SELECT ... FOR UPDATE` (lock first, then decide) or SERIALIZABLE isolation
   with retries. The conditional UPDATE is simplest for a counter.
3. *What happens if the phone retries after a timeout?* — Same idempotency key → saved response
   returned → one order, one charge.
4. *What if two retries arrive at the same millisecond?* — The second waits on the first's
   uncommitted key row, then returns the first's saved response.
5. *What is a deadlock and how did you avoid it?* — Circular waiting on locks; fixed lock order
   (slot first, then products sorted by id), plus retry on PostgreSQL error 40P01.
