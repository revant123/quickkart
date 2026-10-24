# Day 4 — orders and admin

New today:
- **Customers:** order history, order details, cancel an order (stock and slot place come back)
- **Admins:** inventory (stock, price, hide/show), delivery slots, all orders, order status
  changes, sales reports

Files: `api/src/modules/orders/queries.ts`, `api/src/modules/admin/routes.ts`

Run commands from the **quickkart** folder unless the step says `cd api`.

---

## Task 1 — Run the tests (5 min)

```bash
cd api
npm test
cd ..
```
Done when you see **59 passed** (35 before + 24 new).

---

## Task 2 — Try everything with one command (5 min)

The API must be running (node tab). Then:
```bash
bash scripts/try-day4.sh
```
It walks through 10 steps. Check each result:

| Step | You should see |
|---|---|
| 1 | two orders placed, stock goes down |
| 2 | your order history, newest first, each with its items |
| 3 | `"status":"CANCELLED"` and the stock goes back **up** |
| 4 | `cannot_cancel`: you can't cancel twice |
| 5 | `forbidden`: a customer can't open admin pages (403) |
| 6 | an admin logs in, `"role":"admin"` |
| 7 | `PACKED`, then `OUT_FOR_DELIVERY` |
| 8 | `illegal_transition`: an order can't go backwards |
| 9 | stock increased by 24 |
| 10 | sales report: orders and revenue per store per day |

If it says "No free delivery slots":
```bash
docker compose exec -T db psql -U quickkart -d quickkart < db/queries/add-slots.sql
```

---

## Task 3 — Know these four ideas (15 min)

**1. Order status is a state machine.**
`PLACED → PACKED → OUT_FOR_DELIVERY → DELIVERED`, and `PLACED/PACKED → CANCELLED`.
The allowed "from" states are checked **inside the UPDATE**
(`WHERE status = ANY(allowed)`), the same trick as stock: check and write in one step,
so two admins clicking at once can't break it. Illegal moves return **409**.

**2. Cancelling is all-or-nothing, and can't happen twice.**
One transaction: set status CANCELLED, give back the slot place, give back each item's
stock. The status UPDATE only matches `PLACED` or `PACKED` orders, so if 10 cancel requests
arrive together, the first wins and the other 9 find `CANCELLED` and get 409.
The test proves stock comes back **once**, not 10 times.

**3. Admins adjust stock by +/−, never "set to".**
If the admin screen shows 10 and they type "set to 34", but 2 were sold while the screen
was open, those 2 sales are erased (the lost-update bug again, caused by a human).
`stock = stock + 24` is always correct. `CHECK (stock >= 0)` refuses going below zero (409).

**4. Someone else's order gives 404, not 403.**
403 would confirm "this order exists, you just can't see it", which leaks information
(OWASP calls this "insecure direct object reference"). 404 reveals nothing.

Also: order history uses `json_agg` to return each order **with its items in one query**,
instead of 1 query for orders + 1 per order for items (the "N+1 queries" problem).

---

## Task 4 — Add to notes.md and push

Add this at the bottom of `docs/notes.md`:
```
## Day 4
- Order status is a state machine; legal moves are enforced inside the UPDATE (409 if illegal).
- Cancel = one transaction: status, slot place and stock all restored, and only once
  (10 simultaneous cancels -> 1 success, 9 x 409).
- Admin stock changes are relative (+24), never absolute, so sales made meanwhile aren't lost.
- Another user's order returns 404, not 403, so we don't reveal that it exists.
- json_agg returns orders with their items in one query (avoids N+1 queries).
- Access control: 401 = not logged in, 403 = logged in but not an admin.
```

```bash
git add .
git commit -m "Day 4: order history, cancel, admin APIs and reports"
git push
```
Then tell Claude **"Day 4 done"**. Day 5 is the website itself (React).

---

## Making yourself an admin (needed on Day 5)

There is deliberately no API to become an admin. After you register on the website tomorrow:
```bash
bash scripts/make-admin.sh your-email@example.com
```
Then log out and log in again.

---

## New API routes

| Method | Path | Who |
|---|---|---|
| GET | /api/orders | customer: my orders |
| GET | /api/orders/:id | customer: one of my orders |
| POST | /api/orders/:id/cancel | customer |
| GET | /api/admin/stores/:storeId/inventory?q=&lowStockBelow= | admin |
| PATCH | /api/admin/stores/:storeId/inventory/:productId | admin |
| POST | /api/admin/stores/:storeId/slots | admin |
| GET | /api/admin/orders?storeId=&status= | admin |
| GET | /api/admin/orders/:id | admin |
| PATCH | /api/admin/orders/:id/status | admin |
| GET | /api/admin/reports/sales?from=&to= | admin |
| GET | /api/admin/reports/top-products?storeId=&days= | admin |
| GET | /api/admin/reports/slots?storeId= | admin |
