# Interview prep

How to present QuickKart, and the questions you should be able to answer without notes.
Practise saying the answers out loud. Recalling them from memory is what makes them stick.

---

## The 30-second pitch

> "QuickKart is a multi-store grocery delivery platform, like a 10-minute delivery app.
> The interesting part is the backend: I built the checkout so it can't oversell the last
> item, can't overbook a delivery slot, and can't create a duplicate order when the phone
> retries. I proved each one with concurrency tests that fire 10 requests at once, and
> load-tested it: 2,250 orders on a single product at 50 per second, zero oversells.
> It's React and TypeScript on the front, Express and PostgreSQL behind, Redis for caching,
> and the whole thing runs with one Docker command."

## The 5-minute demo

1. **Shop** (1 min): open http://localhost:8080. Point out the delivery band: it's the next
   real slot from the database. Switch stores: prices and stock change (`store_inventory`).
   Search "paneer".
2. **Checkout** (1 min): add items, check out, pick a slot. Show the order page.
3. **The race** (1 min): `cd api && npm run demo:race`. "Naive: 10 orders for 1 item.
   Mine: 1 order, 9 refused." Explain the lost update in two sentences.
4. **The code** (1 min): open `api/src/modules/orders/placeOrder.ts`. Walk through the five
   numbered steps: key, slot, stock, order, saved response. All in one transaction.
5. **Admin + numbers** (1 min): mark the order packed, show sales. Then the performance table
   in the README: cache 14 → 7.7 ms; flash sale 16 → 46 ms and why.

---

## Questions and model answers

### Concurrency and transactions (expect most questions here)

**1. How do you stop two customers buying the last item?**
The stock decrement checks availability inside the write:
`UPDATE store_inventory SET stock = stock - qty WHERE … AND stock >= qty`.
The UPDATE locks the row. A second request waits; when the first commits, PostgreSQL
re-evaluates the WHERE clause on the new value (0), so the second updates nothing and gets
409. There's no gap between checking and writing. A `CHECK (stock >= 0)` constraint backs it up.

**2. Wouldn't wrapping the code in a transaction be enough?**
No. At PostgreSQL's default isolation (Read Committed), a plain SELECT takes no lock, so both
transactions read stock = 1 and both write 0. That's the lost-update anomaly. My race-demo
test shows it. You need the condition in the UPDATE, a `SELECT … FOR UPDATE`, or SERIALIZABLE
isolation with retries.

**3. When would you use SELECT … FOR UPDATE instead?**
When the decision can't fit in one WHERE clause, e.g. "allow it if the customer's total this
week is under a limit and the item is in stock". You lock the rows first, read, decide in
code, then write. It holds locks longer, so I use the single conditional UPDATE when it's enough.

**4. What's a deadlock and how did you avoid it?**
Two transactions each hold a lock the other needs: A locks milk and wants bread, B locks bread
and wants milk. I always lock in the same order (slot first, then products sorted by id), so
the circle can't form. PostgreSQL detects real deadlocks and aborts one (error 40P01);
`withRetry` retries those safely, because an aborted transaction changed nothing.

**5. Explain the isolation levels.**
Read Committed: each statement sees data committed before it started (PostgreSQL's default).
Repeatable Read: the whole transaction sees one snapshot; a concurrent update to the same row
raises a serialization error. Serializable: the result is as if transactions ran one after
another; PostgreSQL aborts one of any dangerous pair, and you retry.

**6. What does ACID mean in your checkout?**
Atomic: slot, stock, order and idempotency key all commit or none do (test 6: second item
sold out → the first item's stock and the slot are untouched). Consistent: constraints hold.
Isolated: concurrent checkouts can't see half-done work. Durable: once 201 is returned, a
crash doesn't lose the order.

### Idempotency and API design

**7. The phone loses connection after the order is created and retries. What happens?**
The app sends the same `Idempotency-Key`. The first statement of checkout inserts that key;
on conflict, I return the saved response with `Idempotent-Replayed: true`. One order, one charge.

**8. And if both requests arrive at the same millisecond?**
The second INSERT waits on the first's uncommitted row because of the unique index. When the
first commits, the second sees the conflict and returns the saved response. Test 4 sends 10 at once.

**9. Why store keys in PostgreSQL, not Redis?**
So the key and the order are in the same transaction. With Redis, a crash between "save key"
and "save order" could leave them inconsistent.

**10. 401 vs 403 vs 404 vs 409?**
401: not logged in. 403: logged in but not allowed (a customer on an admin route).
404: not found, also for someone else's order, so we don't reveal it exists.
409: valid request that conflicts with current state (sold out, slot full, illegal status change).

**11. Which HTTP methods are idempotent?**
GET, PUT and DELETE by definition; POST isn't, which is why creating an order needs a key.

### Database design and performance

**12. Why a store_inventory table?**
Price and stock belong to a (store, product) pair, not a product. Product details are stored
once; per-store facts live in a junction table with primary key (store_id, product_id).

**13. Why integer paise?**
Floating point can't represent 0.1 exactly, so totals drift. Integers are exact.

**14. How did you make search fast?**
I measured with EXPLAIN ANALYZE first: a sequential scan of 50,000 rows. A B-tree index can't
help `ILIKE '%term%'`, so I added a trigram (pg_trgm GIN) index: 19 ms → 0.5 ms for a rare
term. A common term improved much less, because it matches hundreds of rows that still have
to be sorted. That's what the cache then fixed.

**15. Offset or keyset pagination?**
Keyset: "rows after (name, id) of the last one seen". Offset makes the database read and throw
away all earlier rows, and shows duplicates if rows are added while scrolling. Keyset costs the
same on every page. Trade-off: no jumping to page 37.

**16. What does an index cost?**
Disk space and slower writes. And it doesn't help unselective queries; the planner may rightly
choose a full scan when most rows match.

### Caching

**17. What do you cache, and what don't you?**
Only catalog browse and search, for 30 seconds. Never stock or prices used by checkout, slot
capacity, or anyone's orders. Checkout always reads PostgreSQL, so a stale cache can make the
shop page a few seconds behind but can never cause an oversell. A test proves exactly that.

**18. How do you invalidate?**
Each store has a version number in Redis, and it's part of every cache key. An admin edit
increments it, so all old keys for that store stop being used at once and expire on their own.

**19. What if Redis goes down?**
Every cache call has a 250 ms timeout and falls back to PostgreSQL. The site gets slower, not
broken. Tested.

**20. Did the cache help?**
Search for "paneer" under 50 concurrent users: 155 → 3,061 req/s. In the lighter k6 browse
test, p95 went 14.1 → 7.7 ms. At low load the database was fast enough anyway, so I'd only add
a cache once measurements show a need.

### Frontend

**21. Component state vs server state?**
Server state (products, orders, current user) lives in the database; the browser holds a
possibly stale copy, managed by TanStack Query (caching, refetching, cancelling outdated
requests). Client state (cart, open drawer, form inputs) lives only in the browser:
useState, useReducer, Context.

**22. How do you handle loading and errors?**
Every data view has four states: loading, error (with "Try again"), empty, and success.
A shared Feedback component covers the first three. API errors become one plain sentence.

**23. How does the checkout button use the idempotency key?**
One UUID per intended order. Network errors and 5xx are retried with the same key; 4xx
never are. If the cart, slot or address changes, it's a new order with a new key.

**24. Is hiding admin pages security?**
No. The server checks the role on every admin route; hiding pages only improves UX.

### Docker and system design

**25. Image vs container? Volumes? Ports?**
An image is a read-only template; a container is a running instance with its own writable
layer. Volumes keep data outside the container's life (the `pgdata` volume survives
`docker compose down`). In `8080:80`, 8080 is the port on my machine, 80 inside the container.

**26. How do the containers find each other?**
By service name on the Compose network: the API connects to `db:5432` and `redis:6379`;
nginx forwards to `api:4000`. Inside a container, `localhost` means that container itself.

**27. How would you scale this?**
Measure first. Then: more API containers (stateless, so one command), PgBouncer for
connections, cache and read replicas for reads, a queue plus transactional outbox for side
effects, and finally partitioning by store or city, since quick commerce is local.
Details in scaling.md.

**28. What's your bottleneck right now?**
In the flash sale: one stock row. At 50 orders/s p95 rose from 16 to 46 ms because orders
queue for the same row lock. More API servers can't help. Bucketing the stock across several
rows, or queueing orders for that product, would.

**29. Why not microservices?**
I don't know the right boundaries yet, and splitting adds network failures and distributed
transactions to checkout. It's a modular monolith; the catalog read path would be the first to
extract if it needed to scale separately.

**30. What would you do differently?**
A migration tool for schema changes; payments as a separate state with webhooks; CI running
the tests on every push; a clean-up job for old idempotency keys.

---

## Questions to ask yourself while reading the code

- `api/src/modules/orders/placeOrder.ts`: what happens if step 3 fails for the second item?
- `api/src/modules/orders/queries.ts`: why can't stock be returned twice by two cancels?
- `api/src/cache.ts`: why `enableOfflineQueue: false`?
- `web/src/pages/CheckoutPage.tsx`: when exactly is a new idempotency key created?
