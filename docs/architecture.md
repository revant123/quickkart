# Architecture

QuickKart is a **modular monolith**: one API codebase with clear internal modules (auth,
catalog, orders, admin), one PostgreSQL database as the single source of truth, and Redis
as a disposable cache. Everything runs with one command through Docker Compose.

The diagrams below follow the C4 model's idea of zoom levels: who uses the system, then
the running pieces, then the most important flow in detail. GitHub draws them from the
text in this file.

## 1. Context: who uses it

```mermaid
flowchart LR
  customer["Customer<br/>browses, orders, tracks or cancels"]
  admin["Store staff<br/>stock, prices, slots, order status, sales"]
  qk["QuickKart<br/>multi-store quick commerce"]
  customer -->|web browser| qk
  admin -->|web browser, admin area| qk
```

## 2. Containers: the running pieces

```mermaid
flowchart LR
  browser["Browser<br/>React + TypeScript app"]
  subgraph compose["Docker Compose network"]
    web["web: nginx<br/>serves the React build<br/>forwards /api"]
    api["api: Express 5 + TypeScript<br/>stateless, scale with --scale api=N"]
    db[("db: PostgreSQL 18<br/>stock, slots, orders,<br/>idempotency keys")]
    redis[("redis<br/>catalog cache,<br/>rate-limit counters")]
    mailpit["mailpit<br/>test inbox :8025"]
  end
  razorpay["Razorpay<br/>(test mode)"]
  browser -->|"HTTP :8080"| web
  web -->|"/api/* to api:4000"| api
  api -->|"SQL, pooled connections"| db
  api -.->|"cache-aside, 30 s TTL"| redis
  api -.->|"outbox job: emails, SMS"| mailpit
  api <-->|"orders, refunds / webhooks"| razorpay
  browser -.->|"payment window"| razorpay
```

- **Only nginx is public.** The API has no published port; nginx reaches it by its service
  name `api`. Docker's DNS returns every API container, so nginx spreads requests across them.
- **The API keeps no state in memory.** The login is a signed JWT in an httpOnly cookie, so
  any API container can serve any request. That is what makes horizontal scaling a one-liner.
- **PostgreSQL decides everything that matters**: stock, slot capacity, orders, idempotency.
- **Redis is optional.** If it is down, catalog reads go to PostgreSQL. Checkout never reads it.

## 3. Data model

```mermaid
erDiagram
  USERS ||--o{ ORDERS : places
  USERS ||--o{ IDEMPOTENCY_KEYS : sends
  STORES ||--o{ STORE_INVENTORY : stocks
  PRODUCTS ||--o{ STORE_INVENTORY : "is stocked as"
  CATEGORIES ||--o{ PRODUCTS : groups
  STORES ||--o{ DELIVERY_SLOTS : offers
  STORES ||--o{ ORDERS : fulfils
  DELIVERY_SLOTS ||--o{ ORDERS : "delivers in"
  ORDERS ||--|{ ORDER_ITEMS : contains
  PRODUCTS ||--o{ ORDER_ITEMS : "appears in"

  STORE_INVENTORY {
    bigint store_id PK
    bigint product_id PK
    int price_paise "CHECK > 0"
    int stock "CHECK >= 0"
    bool is_listed
  }
  DELIVERY_SLOTS {
    bigint id PK
    bigint store_id FK
    timestamptz starts_at
    int capacity
    int booked "CHECK booked <= capacity"
  }
  ORDERS {
    bigint id PK
    text status "state machine"
    int total_paise
  }
  ORDER_ITEMS {
    bigint order_id PK
    bigint product_id PK
    int quantity
    int unit_price_paise "price at purchase time"
  }
  IDEMPOTENCY_KEYS {
    bigint user_id PK
    text key PK
    text request_hash
    jsonb response_body
  }
```

- **`store_inventory` is the multi-store design.** Price and stock are facts about a
  (store, product) pair, so they live in a junction table keyed by both. Product details
  are stored once.
- **Money is integer paise.** Floating point can't represent 0.1 exactly.
- **Constraints are the last line of defence**: `stock >= 0` and `booked <= capacity` hold
  even if application code has a bug.
- **Order lines copy the price paid**, so later price changes don't rewrite history.

## 4. Checkout: the critical flow

Everything below runs in **one transaction**. Any failure rolls back all of it.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant P as PostgreSQL
  B->>A: POST /api/orders (Idempotency-Key: k1)
  A->>P: BEGIN
  A->>P: INSERT idempotency_keys (user, k1) ON CONFLICT DO NOTHING
  alt key already used
    P-->>A: 0 rows (waits if the first request is still running)
    A->>P: SELECT saved response
    A-->>B: 201 same order (Idempotent-Replayed: true)
  else new key
    A->>P: UPDATE delivery_slots SET booked = booked + 1 WHERE booked < capacity
    A->>P: UPDATE store_inventory SET stock = stock - qty WHERE stock >= qty (each item, sorted by id)
    A->>P: INSERT orders, order_items (prices read from the database)
    A->>P: UPDATE idempotency_keys SET response = order
    A->>P: COMMIT
    A-->>B: 201 Created {orderId}
  end
  Note over A,P: 0 rows from a slot or stock UPDATE: ROLLBACK, 409 slot_unavailable / out_of_stock
```

Why each step is safe:
1. **Check inside the write.** `WHERE stock >= qty` is evaluated by the UPDATE itself. A
   concurrent order waits for the row lock, then PostgreSQL re-checks the condition on the
   new value. There is no gap between checking and writing.
2. **Fixed lock order** (slot first, then products by id) prevents deadlocks; `withRetry`
   handles the rare leftover deadlock or serialization error.
3. **Idempotency key in the same transaction** as the order: either both exist or neither.

## 5. Order status: a state machine

```mermaid
stateDiagram-v2
  [*] --> PLACED: checkout, cash on delivery
  [*] --> PENDING_PAYMENT: checkout, pay online
  PENDING_PAYMENT --> PLACED: payment verified (browser or webhook)
  PENDING_PAYMENT --> CANCELLED: not paid in 15 min (job), or customer
  PLACED --> PACKED: admin
  PACKED --> OUT_FOR_DELIVERY: rider picks up (or admin)
  OUT_FOR_DELIVERY --> DELIVERED: rider (or admin)
  PLACED --> CANCELLED: customer or admin
  PACKED --> CANCELLED: customer or admin
  DELIVERED --> [*]
  CANCELLED --> [*]
```

Allowed "from" states are checked inside the UPDATE (`WHERE status = ANY(allowed)`), so two
admins clicking at once can't skip a step. Cancelling returns the stock and the slot place
in the same transaction, exactly once.

## 6. Paying online

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant D as PostgreSQL
  participant R as Razorpay
  B->>A: POST /orders {paymentMethod: online}
  A->>D: ONE transaction: take stock, book slot, order PENDING_PAYMENT
  A-->>B: 201 orderId (items held 15 min)
  B->>A: POST /orders/:id/payment
  A->>R: create order (amount, receipt)
  A-->>B: key + Razorpay order id
  B->>R: customer pays in Razorpay's window
  R-->>B: payment id + signature
  B->>A: POST /orders/:id/payment/verify
  A->>A: HMAC(order_id|payment_id, secret) matches?
  A->>D: payment paid, order PLACED, outbox: "order placed" email + SMS
  R-)A: webhook payment.captured (same effect, deduplicated)
```

If nobody pays, the expiry job cancels the order and the stock goes back. If money arrives
for a cancelled order, the refund job pays it back. Details: [ADR 0008](adr/0008-online-payments-pending-order-webhook-expiry-refund.md).

## 7. Code layout

| Folder | Responsibility |
|---|---|
| `api/src/modules/auth` | register, login, logout, current user |
| `api/src/modules/catalog` | stores, aisles, slots, product search with keyset pagination |
| `api/src/modules/orders` | checkout (`placeOrder.ts`), history, cancel |
| `api/src/modules/admin` | inventory, slots, order status, reports |
| `api/src/modules/payments` | gateways (Razorpay, built-in test), verify, webhook, expiry and refund jobs |
| `api/src/modules/location` | nearest store, pincodes, saved addresses |
| `api/src/modules/rider` | rider board, race-safe pickup, delivery; admin rider management |
| `api/src/notifications` | transactional outbox, email/SMS templates, sender job |
| `api/src/db.ts` | connection pool, `withTransaction`, `withRetry` |
| `api/src/cache.ts` | Redis cache-aside with versioned keys and safe fallback |
| `web/src/features` | auth, location picker, addresses, payments, cart, live updates |
| `web/src/pages` | shop, checkout, orders, account, rider, admin dashboard |

These module boundaries are where the monolith could be split later if one part ever needs
to scale or deploy on its own. See [scaling.md](scaling.md) and [ADRs](adr/).
