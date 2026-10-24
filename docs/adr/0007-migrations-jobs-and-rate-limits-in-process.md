# ADR 0007: Migrations, background jobs and rate limits inside the API

**Status:** accepted

## Context
The schema has to change on databases that already hold data. Old idempotency keys must be
deleted regularly. Login, sign-up and checkout need protection from abuse. And the app must
still run on a free hosting tier, which has no separate worker or cron service.

## Decision
- **Migrations:** numbered SQL files in `api/migrations/`, each applied once inside a
  transaction and recorded in `schema_migrations`. The API applies pending ones at start-up
  under a PostgreSQL **advisory lock**, so several containers starting together take turns.
  `0001_baseline` uses `IF NOT EXISTS`, so databases created before migrations upgrade cleanly.
- **Jobs:** timers inside each API process. Each run first takes `pg_try_advisory_lock`;
  only the instance that gets it does the work (tested with 5 simultaneous runs).
- **Rate limits:** `express-rate-limit` with counts stored in Redis, so all containers share
  one count; per IP for login/sign-up (30 per 15 min), per user for checkout (60 per min).
  If Redis is down, requests pass (availability over strictness).

## Consequences
- **Good:** no extra services; works the same in Docker, CI and on a free host.
- **Cost:** a long migration delays start-up; destructive changes need care (expand, migrate
  data, then contract, across releases).
- **Cost:** jobs only run while an API instance is up; a dedicated worker or scheduler
  becomes worthwhile when jobs get heavy.
- **Note:** load tests turn rate limiting off, since k6 simulates hundreds of customers from
  one machine, which the limits rightly treat as abuse.
