# ADR 0003: Idempotency keys, stored in PostgreSQL with the order

**Status:** accepted

## Context
Networks fail after the server has done the work: the order is created but the response
never reaches the phone, and the app retries. POST is not idempotent, so a naive retry
creates a second order. Disabling the button doesn't help; the duplicate comes from the network.

## Decision
The client sends an `Idempotency-Key` header (a UUID per intended order, reused on retries),
as in Stripe's API and the IETF Idempotency-Key draft. The server:
1. inserts `(user_id, key, request_hash)` with `ON CONFLICT DO NOTHING` as the **first**
   statement of the checkout transaction;
2. on conflict, returns the saved response (`Idempotent-Replayed: true`), or 422 if the same
   key arrives with a different body;
3. saves the response in the same transaction as the order.

## Consequences
- **Good:** the key and the order commit or roll back together. A failed checkout leaves no
  key behind, so the client can retry.
- **Good:** two simultaneous requests with the same key: the second INSERT waits on the
  first's uncommitted row (unique index), then sees the conflict. No extra locking code.
  Tested with 10 simultaneous requests.
- **Good:** keys are scoped per user, so users can't collide or see each other's results.
- **Cost:** one table that grows; old keys (over 24 h) should be deleted by a scheduled job
  (`idx_idempotency_created` makes this cheap). Not yet automated.
- **Alternative considered:** keys in Redis with `SET NX`. Faster, but the key and the order
  would live in two systems with no shared transaction, so a crash between them could
  leave them inconsistent.
