#!/usr/bin/env bash
# Tries the Day 4 features through the running API: order history, cancelling,
# and the admin APIs. Run from the quickkart folder with the API running:
#   bash scripts/try-day4.sh
set -euo pipefail

API="${API:-http://localhost:4000}"
PSQL="${PSQL:-docker compose exec -T db psql -U quickkart -d quickkart -Atq}"
CUSTOMER="$(mktemp)"; ADMIN="$(mktemp)"
trap 'rm -f "$CUSTOMER" "$ADMIN"' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
sql() { $PSQL -c "$1"; }
show() { if command -v python3 >/dev/null; then python3 -m json.tool 2>/dev/null || cat; else cat; fi; }
post() { curl -s -b "$1" -X POST "$API$2" -H 'Content-Type: application/json' "${@:3}"; }
patch() { curl -s -b "$1" -X PATCH "$API$2" -H 'Content-Type: application/json' -d "$3"; }

TS="$(date +%s)"
SLOT="$(sql "SELECT id FROM delivery_slots WHERE store_id = 1 AND starts_at > now() AND booked + 2 <= capacity ORDER BY starts_at LIMIT 1")"
if [ -z "$SLOT" ]; then
  echo "No free delivery slots. Run: docker compose exec -T db psql -U quickkart -d quickkart < db/queries/add-slots.sql"
  exit 1
fi
PRODUCT="$(sql "SELECT product_id FROM store_inventory WHERE store_id = 1 AND stock >= 5 AND is_listed ORDER BY product_id LIMIT 1")"
order_body() { echo "{\"storeId\":1,\"slotId\":$SLOT,\"address\":\"12 Sector 17, Chandigarh\",\"items\":[{\"productId\":$PRODUCT,\"quantity\":$1}]}"; }

say "1. A customer registers and places two orders"
curl -s -c "$CUSTOMER" -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"customer$TS@quickkart.test\",\"password\":\"password123\",\"name\":\"Asha\"}" >/dev/null
ORDER1="$(post "$CUSTOMER" /api/orders -H "Idempotency-Key: a-$TS" -d "$(order_body 2)" | sed -E 's/.*"orderId":"([0-9]+)".*/\1/')"
ORDER2="$(post "$CUSTOMER" /api/orders -H "Idempotency-Key: b-$TS" -d "$(order_body 1)" | sed -E 's/.*"orderId":"([0-9]+)".*/\1/')"
echo "Orders $ORDER1 and $ORDER2 placed (product $PRODUCT, slot $SLOT)."
echo "Stock of product $PRODUCT now: $(sql "SELECT stock FROM store_inventory WHERE store_id=1 AND product_id=$PRODUCT")"

say "2. Order history (GET /api/orders): newest first, items included"
curl -s -b "$CUSTOMER" "$API/api/orders" | show | head -40

say "3. Customer cancels order $ORDER2 -> stock and slot place come back"
post "$CUSTOMER" "/api/orders/$ORDER2/cancel"; echo
echo "Stock of product $PRODUCT now: $(sql "SELECT stock FROM store_inventory WHERE store_id=1 AND product_id=$PRODUCT")"

say "4. Cancelling it AGAIN -> 409 cannot_cancel"
post "$CUSTOMER" "/api/orders/$ORDER2/cancel"; echo

say "5. The customer tries an admin page -> 403 forbidden"
curl -s -b "$CUSTOMER" "$API/api/admin/orders"; echo

say "6. Make an admin and log in"
ADMIN_EMAIL="admin$TS@quickkart.test"
curl -s -X POST "$API/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"password123\",\"name\":\"Admin\"}" >/dev/null
sql "UPDATE users SET role = 'admin' WHERE email = '$ADMIN_EMAIL'" >/dev/null
curl -s -c "$ADMIN" -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"password123\"}"; echo

say "7. Admin moves order $ORDER1 along: PACKED -> OUT_FOR_DELIVERY"
patch "$ADMIN" "/api/admin/orders/$ORDER1/status" '{"status":"PACKED"}'; echo
patch "$ADMIN" "/api/admin/orders/$ORDER1/status" '{"status":"OUT_FOR_DELIVERY"}'; echo

say "8. Illegal jump back to PACKED -> 409 illegal_transition"
patch "$ADMIN" "/api/admin/orders/$ORDER1/status" '{"status":"PACKED"}'; echo

say "9. A delivery of 24 arrives: admin adds +24 stock (relative, not absolute)"
patch "$ADMIN" "/api/admin/stores/1/inventory/$PRODUCT" '{"adjustStockBy":24}'; echo

say "10. Sales report (cancelled orders excluded)"
curl -s -b "$ADMIN" "$API/api/admin/reports/sales" | show | head -20
