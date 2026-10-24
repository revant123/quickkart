-- 0004 commerce: where stores are, saved addresses, payments, account tokens,
-- the notifications outbox and delivery riders.

-- ---------------------------------------------------------------------------
-- Location
-- ---------------------------------------------------------------------------

-- Great-circle distance in km (haversine formula). IMMUTABLE: same inputs, same
-- answer, so PostgreSQL may use it in indexes and inline it into queries.
CREATE OR REPLACE FUNCTION km_between(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
RETURNS float8 LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN 2 * 6371 * asin(sqrt(
  power(sin(radians(lat2 - lat1) / 2), 2) +
  cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));

ALTER TABLE stores ADD COLUMN IF NOT EXISTS address   TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS lat       FLOAT8 CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS lng       FLOAT8 CHECK (lng BETWEEN -180 AND 180);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS radius_km FLOAT8 NOT NULL DEFAULT 7 CHECK (radius_km > 0);

-- The 3 sample stores (existing databases). New databases get these from the seed.
UPDATE stores SET address = 'Sector 17, Chandigarh', lat = 30.7410, lng = 76.7820
 WHERE pincode = '160017' AND lat IS NULL;
UPDATE stores SET address = 'Sector 11, Chandigarh', lat = 30.7580, lng = 76.7770
 WHERE pincode = '160011' AND lat IS NULL;
UPDATE stores SET address = 'Phase 8, Mohali', lat = 30.7000, lng = 76.7200
 WHERE pincode = '160062' AND lat IS NULL;

-- Reference data: the centre point of each pincode we know. Lets "enter your
-- pincode" work without a maps API. Points are approximate, good to ~1 km.
CREATE TABLE IF NOT EXISTS pincodes (
  pincode TEXT PRIMARY KEY CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  area    TEXT   NOT NULL,
  city    TEXT   NOT NULL,
  lat     FLOAT8 NOT NULL,
  lng     FLOAT8 NOT NULL
);
INSERT INTO pincodes (pincode, area, city, lat, lng) VALUES
  ('160009', 'Sector 9',            'Chandigarh', 30.7490, 76.7930),
  ('160011', 'Sector 11',           'Chandigarh', 30.7580, 76.7770),
  ('160012', 'Sector 12, PGI',      'Chandigarh', 30.7650, 76.7750),
  ('160014', 'Sector 14, PU',       'Chandigarh', 30.7600, 76.7680),
  ('160015', 'Sector 15',           'Chandigarh', 30.7520, 76.7700),
  ('160016', 'Sector 16',           'Chandigarh', 30.7470, 76.7880),
  ('160017', 'Sector 17',           'Chandigarh', 30.7410, 76.7820),
  ('160018', 'Sector 18',           'Chandigarh', 30.7340, 76.7930),
  ('160019', 'Sector 19',           'Chandigarh', 30.7300, 76.7990),
  ('160020', 'Sector 20',           'Chandigarh', 30.7230, 76.7900),
  ('160022', 'Sector 22',           'Chandigarh', 30.7330, 76.7750),
  ('160023', 'Sector 23',           'Chandigarh', 30.7400, 76.7680),
  ('160030', 'Sector 30',           'Chandigarh', 30.7120, 76.7970),
  ('160036', 'Sector 36',           'Chandigarh', 30.7370, 76.7570),
  ('160047', 'Sector 47',           'Chandigarh', 30.6970, 76.7700),
  ('160055', 'Phase 3B',            'Mohali',     30.7180, 76.7210),
  ('160059', 'Phase 7',             'Mohali',     30.7100, 76.7330),
  ('160062', 'Phase 8',             'Mohali',     30.7000, 76.7200),
  ('160071', 'Phase 11',            'Mohali',     30.6880, 76.7290),
  ('134109', 'Sector 5',            'Panchkula',  30.6940, 76.8600),
  ('134112', 'Sector 10',           'Panchkula',  30.6990, 76.8560),
  ('140603', 'Zirakpur',            'Zirakpur',   30.6430, 76.8170)
ON CONFLICT (pincode) DO NOTHING;

-- Saved delivery addresses. Orders copy the address text, so editing or deleting
-- an address never changes where a past order went.
CREATE TABLE IF NOT EXISTS addresses (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT   NOT NULL DEFAULT 'Home',
  line1      TEXT   NOT NULL,                -- house / flat, street
  line2      TEXT,                           -- area, landmark
  city       TEXT   NOT NULL,
  pincode    TEXT   NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  phone      TEXT   NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),   -- Indian mobile, 10 digits
  lat        FLOAT8 NOT NULL,                -- from the phone's GPS, or the pincode centre
  lng        FLOAT8 NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses (user_id);
-- At most ONE default address per user, enforced by the database
CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_address ON addresses (user_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- Orders: payment, delivery location, rider
-- ---------------------------------------------------------------------------

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
  ('PENDING_PAYMENT', 'PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'));

-- Orders before this migration were all pay-on-delivery
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cod'
  CHECK (payment_method IN ('cod', 'online'));
-- unpaid: cash due on delivery · pending: waiting for online payment · paid
-- failed: online payment never completed · refund_pending -> refunded: paid, then cancelled
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refund_pending', 'refunded'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_id BIGINT REFERENCES addresses(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lat FLOAT8;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_lng FLOAT8;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_id BIGINT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- The expiry job looks for unpaid online orders past their deadline
CREATE INDEX IF NOT EXISTS idx_orders_payment_expiry ON orders (payment_expires_at)
  WHERE status = 'PENDING_PAYMENT';
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders (rider_id, status) WHERE rider_id IS NOT NULL;

-- One row per payment-gateway order (Razorpay "order_..."), i.e. per QuickKart order.
CREATE TABLE IF NOT EXISTS payments (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id            BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  provider            TEXT   NOT NULL CHECK (provider IN ('razorpay', 'fake')),
  provider_order_id   TEXT   NOT NULL UNIQUE,
  provider_payment_id TEXT   UNIQUE,
  amount_paise        INTEGER NOT NULL CHECK (amount_paise > 0),
  status              TEXT   NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'paid', 'refunded')),
  refund_id           TEXT,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook events already handled. Gateways deliver the same event more than once;
-- the primary key turns a repeat into a no-op.
CREATE TABLE IF NOT EXISTS payment_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Accounts: email verification and password reset links
-- ---------------------------------------------------------------------------

-- Only a SHA-256 hash of each token is stored: a leaked database can't be used
-- to reset anyone's password. Tokens are single use and expire.
CREATE TABLE IF NOT EXISTS user_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT   NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT   NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens (user_id, purpose);

-- ---------------------------------------------------------------------------
-- Notifications: the transactional outbox
-- ---------------------------------------------------------------------------

-- A message is INSERTed in the same transaction as the change it reports
-- (order placed, rider picked up...), so it exists if and only if the change
-- committed. A background job sends it afterwards and retries on failure.
CREATE TABLE IF NOT EXISTS outbox (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel         TEXT  NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient       TEXT  NOT NULL,
  template        TEXT  NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}',
  status          TEXT  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox (next_attempt_at) WHERE status = 'pending';
