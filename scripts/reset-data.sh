#!/usr/bin/env bash
# Wipes ALL data (users, orders, products...) and loads fresh sample data.
# Tables and indexes are kept. Run from the quickkart folder:
#   bash scripts/reset-data.sh
set -euo pipefail
PSQL="${PSQL:-docker compose exec -T db psql -U quickkart -d quickkart -v ON_ERROR_STOP=1 -q}"

echo "Wiping data and loading fresh sample data (takes about a minute)..."
{
  echo "TRUNCATE users, stores, categories, products, store_inventory, delivery_slots,"
  echo "         orders, order_items, idempotency_keys, product_images, addresses,"
  echo "         payments, payment_events, user_tokens, outbox RESTART IDENTITY CASCADE;"
  cat db/seed/seed.sql
} | $PSQL

$PSQL -At -c "SELECT 'Done: ' || (SELECT count(*) FROM products) || ' products, ' ||
  (SELECT count(*) FROM store_inventory) || ' stock rows, ' ||
  (SELECT count(*) FROM delivery_slots) || ' delivery slots. All accounts were removed: register again.'"
