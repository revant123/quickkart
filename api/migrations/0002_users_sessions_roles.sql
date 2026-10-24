-- 0002: session versions, the rider role, and account fields.

-- The login token stores the user's token_version. Every request checks it
-- against this column, so bumping it (e.g. after a password reset) logs out
-- every existing session at once. The role is also read from here on each
-- request, so promoting or demoting a user takes effect immediately.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- A third role: delivery riders, each attached to one store
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin', 'rider'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id BIGINT REFERENCES stores(id);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rider_has_store;
ALTER TABLE users ADD CONSTRAINT users_rider_has_store CHECK (role <> 'rider' OR store_id IS NOT NULL);

-- Account fields used for email verification and SMS
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
