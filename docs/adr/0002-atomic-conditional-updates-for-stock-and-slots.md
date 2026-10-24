# ADR 0002: Atomic conditional UPDATEs for stock and slot capacity

**Status:** accepted

## Context
Many customers can try to buy the last item, or book the last place in a delivery slot, at
the same moment. A naive "read stock, check it, write new stock" sequence lets every request
read the same old value and succeed: the **lost update** anomaly. `api/test/race-demo.test.ts`
reproduces it: 10 buyers, 1 item in stock, 10 orders created.

A transaction alone does not fix this: under PostgreSQL's default isolation level
(Read Committed) a plain SELECT takes no lock.

## Decision
Put the check inside the write:
```sql
UPDATE store_inventory SET stock = stock - $qty
 WHERE store_id = $1 AND product_id = $2 AND stock >= $qty
RETURNING price_paise;
```
and the same for slots (`booked = booked + 1 WHERE booked < capacity`). Zero rows returned
means "not available" (409). Rows are always locked in the same order (slot first, then
products sorted by id) to prevent deadlocks, and `withRetry` retries PostgreSQL errors
40001/40P01. `CHECK (stock >= 0)` and `CHECK (booked <= capacity)` back this up.

## Consequences
- **Good:** one statement, no extra round trip, no explicit locks. The UPDATE locks the row;
  a concurrent one waits and PostgreSQL re-evaluates its WHERE clause on the new value.
- **Good:** proven by tests with 10 concurrent requests, and by k6: 2,250 orders at 50/s on
  one product with zero errors.
- **Cost:** all orders for one product queue on one row. At 50 orders/s p95 rose to 46 ms
  (from 16 ms at 20/s). See scaling.md for what to do when that becomes the limit.
- **Alternatives considered:**
  - `SELECT ... FOR UPDATE`, then decide in code: needed when the rule doesn't fit in one
    WHERE clause; holds the lock longer.
  - SERIALIZABLE isolation with retries: handles complex multi-row rules; more aborts under load.
  - Optimistic locking with a version column: suits low contention and long user think time
    (editing forms), not hot counters.
