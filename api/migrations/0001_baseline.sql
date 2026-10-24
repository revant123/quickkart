-- 0001 baseline: the schema built on Days 1-2.
-- Written with IF NOT EXISTS so it is a no-op on a database created before
-- migrations existed, and creates everything on a fresh one.

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram index support for product search

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stores (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      TEXT NOT NULL,
  city      TEXT NOT NULL,
  pincode   TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS categories (
  id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE                  -- URL-friendly name, e.g. 'fruits-vegetables'
);

-- The catalog item itself. Facts about the PRODUCT only (same in every store).
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES categories(id),
  name        TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  unit        TEXT NOT NULL                  -- '500 g', '1 l', '6 pcs'
);

-- One row per (store, product): THIS store's price and stock for THIS product.
-- This junction table is what makes QuickKart multi-store.
CREATE TABLE IF NOT EXISTS store_inventory (
  store_id    BIGINT  NOT NULL REFERENCES stores(id),
  product_id  BIGINT  NOT NULL REFERENCES products(id),
  price_paise INTEGER NOT NULL CHECK (price_paise > 0),   -- money as integer paise, never float
  stock       INTEGER NOT NULL CHECK (stock >= 0),        -- the database refuses negative stock
  is_listed   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id)
);

CREATE TABLE IF NOT EXISTS delivery_slots (
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

CREATE TABLE IF NOT EXISTS orders (
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

CREATE TABLE IF NOT EXISTS order_items (
  order_id         BIGINT  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       BIGINT  NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise INTEGER NOT NULL,     -- price at purchase time; later price changes don't alter it
  PRIMARY KEY (order_id, product_id)
);

-- Remembers checkout requests so a retried request is never processed twice (Day 3)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id       BIGINT NOT NULL REFERENCES users(id),
  key           TEXT   NOT NULL,
  request_hash  TEXT   NOT NULL,
  response_code INTEGER,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Indexes for the queries the app runs
CREATE INDEX IF NOT EXISTS idx_products_category    ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product    ON store_inventory (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_time     ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store_status  ON orders (store_id, status);
CREATE INDEX IF NOT EXISTS idx_idempotency_created  ON idempotency_keys (created_at);

-- Trigram index for product-name search (Day 2)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
