-- QuickKart schema.
-- Runs automatically when the database volume is empty (first `docker compose up`).
-- To re-apply after editing: docker compose down -v && docker compose up -d db

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- text-search index support (used on Day 2)

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      TEXT NOT NULL,
  city      TEXT NOT NULL,
  pincode   TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE categories (
  id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE                  -- URL-friendly name, e.g. 'fruits-vegetables'
);

-- The catalog item itself. Facts about the PRODUCT only (same in every store).
CREATE TABLE products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES categories(id),
  name        TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  unit        TEXT NOT NULL                  -- '500 g', '1 l', '6 pcs'
);

-- One row per (store, product): THIS store's price and stock for THIS product.
-- This junction table is what makes QuickKart multi-store.
CREATE TABLE store_inventory (
  store_id    BIGINT  NOT NULL REFERENCES stores(id),
  product_id  BIGINT  NOT NULL REFERENCES products(id),
  price_paise INTEGER NOT NULL CHECK (price_paise > 0),   -- money as integer paise, never float
  stock       INTEGER NOT NULL CHECK (stock >= 0),        -- the database refuses negative stock
  is_listed   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id)
);

CREATE TABLE delivery_slots (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id  BIGINT  NOT NULL REFERENCES stores(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ NOT NULL,
  capacity  INTEGER NOT NULL CHECK (capacity > 0),
  booked    INTEGER NOT NULL DEFAULT 0,
  CHECK (booked >= 0 AND booked <= capacity),             -- never overbooked
  CHECK (ends_at > starts_at),
  UNIQUE (store_id, starts_at)
);

CREATE TABLE orders (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  store_id    BIGINT NOT NULL REFERENCES stores(id),
  slot_id     BIGINT NOT NULL REFERENCES delivery_slots(id),
  status      TEXT NOT NULL DEFAULT 'PLACED' CHECK (status IN
                ('PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
  total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
  address     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id         BIGINT  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       BIGINT  NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise INTEGER NOT NULL,     -- price at purchase time; later price changes don't alter it
  PRIMARY KEY (order_id, product_id)
);

-- Remembers checkout requests so a retried request is never processed twice (Day 3)
CREATE TABLE idempotency_keys (
  user_id       BIGINT NOT NULL REFERENCES users(id),
  key           TEXT   NOT NULL,
  request_hash  TEXT   NOT NULL,
  response_code INTEGER,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
