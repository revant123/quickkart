# ADR 0001: PostgreSQL with hand-written SQL, no ORM

**Status:** accepted

## Context
The core of QuickKart is correctness under concurrency: never sell more than the stock,
never overbook a delivery slot, never create an order twice. That depends on exactly which
SQL runs, in which transaction, and which rows it locks.

## Decision
Use PostgreSQL through `node-postgres` (`pg`) with hand-written, parameterised SQL.
A small `withTransaction` helper borrows one connection for a whole transaction.

## Consequences
- **Good:** every lock and isolation behaviour is visible in the code and can be tested.
  Features like `ON CONFLICT`, `RETURNING`, `json_agg`, row comparisons for keyset
  pagination and trigram indexes are used directly.
- **Good:** all values go through `$1, $2` placeholders, so SQL injection is ruled out.
- **Cost:** more SQL to write; no automatic type generation from the schema; schema changes
  are applied by init scripts rather than a migration tool. Adding `node-pg-migrate` is the
  next step before a real deployment.
- **Alternatives considered:** Prisma (fast to build, hides locking and transactions),
  Kysely (type-safe SQL builder, a good later upgrade).
