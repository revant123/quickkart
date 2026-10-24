# ADR 0006: Live updates with PostgreSQL LISTEN/NOTIFY and Server-Sent Events

**Status:** accepted

## Context
Shoppers should see stock run low or sell out, delivery slots fill, and their order move
from Placed to Delivered, without reloading. Staff should see new orders arrive. The API
runs as several identical containers, so an order handled by one container must reach
browsers connected to the others.

## Decision
- **Publish from the transaction:** checkout, cancel and admin edits call
  `pg_notify('quickkart_live', event)` inside their transaction. PostgreSQL delivers the
  notification **only if the transaction commits**, so a failed checkout announces nothing
  (tested).
- **Fan out per container:** each API instance holds one connection that `LISTEN`s, and
  forwards matching events to its browsers over **Server-Sent Events** (`text/event-stream`).
- **Three streams with filtering on the server:** `/api/stores/:id/live` (public: in/out of
  stock, a count only when 5 or fewer, slot places), `/api/orders/live` (my orders only),
  `/api/admin/live` (everything, exact numbers; admins only).
- **The browser patches its cache:** `EventSource` reconnects by itself; events update
  TanStack Query's cached data in place, so nothing refetches.

## Consequences
- **Good:** no new infrastructure (no WebSocket server, no message broker); works through
  nginx with buffering off; events never describe uncommitted data.
- **Good:** measured in a real browser: another shopper's purchase showed on screen within
  about 15 ms.
- **Cost:** NOTIFY payloads are capped at 8 KB and aren't stored: a browser that is offline
  misses events. That's acceptable because every page load reads fresh data anyway.
- **Cost:** each open tab holds one HTTP connection; fine for thousands, and the API
  containers scale horizontally.
- **Alternatives considered:** polling every few seconds (simple, but slow to react and
  wasteful); WebSockets (two-way, but we only need server-to-browser); Redis pub/sub (an
  extra moving part, and it can't tie publishing to the database commit).
