#!/usr/bin/env bash
# Places real orders through the running API to show the checkout challenges live.
# Run from the quickkart folder, with the API running (npm run dev):
#   bash scripts/try-checkout.sh
set -euo pipefail

API="${API:-http://localhost:4000}"
PSQL="${PSQL:-docker compose exec -T db psql -U quickkart -d quickkart -Atq}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
sql() { $PSQL -c "$1"; }

say "1. Register a new customer"
EMAIL="demo$(date +%s)@quickkart.test"
curl -s -c "$JAR" -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\",\"name\":\"Demo\"}"
echo

SLOT="$(sql "SELECT id FROM delivery_slots WHERE store_id = 1 AND starts_at > now() AND booked < capacity ORDER BY starts_at LIMIT 1")"
if [ -z "$SLOT" ]; then
  echo "No free delivery slots left. Create new ones, then run this again:"
  echo "  docker compose exec -T db psql -U quickkart -d quickkart < db/queries/add-slots.sql"
  exit 1
fi
PRODUCT="$(sql "SELECT product_id FROM store_inventory WHERE store_id = 1 AND stock > 0 ORDER BY product_id LIMIT 1")"
NAME="$(sql "SELECT name FROM products WHERE id = $PRODUCT")"
sql "UPDATE store_inventory SET stock = 1 WHERE store_id = 1 AND product_id = $PRODUCT"
echo "Using slot $SLOT and product $PRODUCT ($NAME). Its stock is now set to exactly 1."

BODY="{\"storeId\":1,\"slotId\":$SLOT,\"address\":\"12 Sector 17, Chandigarh\",\"items\":[{\"productId\":$PRODUCT,\"quantity\":1}]}"
order() {
  curl -s -i -b "$JAR" -X POST "$API/api/orders" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $1" -d "$BODY" | grep -E '^HTTP|^Idempotent|^\{' || true
}
KEY_A="order-$(date +%s)-A"
KEY_B="order-$(date +%s)-B"

say "2. Buy the last one (key A)  -> expect 201 Created"
order "$KEY_A"

say "3. Network retry: SAME request, SAME key A  -> expect 201, same orderId, Idempotent-Replayed"
order "$KEY_A"

say "4. A NEW order (key B) for the same item  -> expect 409 out_of_stock"
order "$KEY_B"

say "5. Stock in the database now (expect 0, NOT -1)"
sql "SELECT stock FROM store_inventory WHERE store_id = 1 AND product_id = $PRODUCT"
