#!/usr/bin/env bash
# Runs a k6 load test against the Docker stack (http://web = nginx -> API).
# The stack must be running first:  docker compose up -d --build
#
#   bash scripts/load-test.sh catalog          browsing and searching
#   bash scripts/load-test.sh checkout         flash sale on one product, 20 orders/s
#   bash scripts/load-test.sh checkout 50      same, 50 orders/s
set -euo pipefail

TEST="${1:-}"
PSQL="docker compose exec -T db psql -U quickkart -d quickkart -Atq -v ON_ERROR_STOP=1"

# k6 plays hundreds of customers from ONE machine, which the API's rate limits
# would (correctly) block as abuse. Turn limits off for the test, back on after.
limits_off() { RATE_LIMIT_ENABLED=false docker compose up -d --wait api >/dev/null; }
limits_on() { docker compose up -d --wait api >/dev/null; }
trap limits_on EXIT

case "$TEST" in
  catalog)
    limits_off
    docker compose --profile load run --rm k6 run /scripts/catalog.js
    ;;
  checkout)
    RATE="${2:-20}"
    # Prepare a "flash sale": one product with huge stock and one delivery slot
    # with huge capacity, so every order CAN succeed and we measure pure speed.
    PRODUCT_ID="$($PSQL -c "SELECT product_id FROM store_inventory WHERE store_id = 1 AND is_listed ORDER BY product_id LIMIT 1")"
    $PSQL -c "UPDATE store_inventory SET stock = 1000000 WHERE store_id = 1 AND product_id = $PRODUCT_ID"
    SLOT_ID="$($PSQL -c "
      INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity)
      VALUES (1, date_trunc('day', now()) + interval '30 days', date_trunc('day', now()) + interval '30 days 30 minutes', 1000000)
      ON CONFLICT (store_id, starts_at) DO UPDATE SET capacity = 1000000
      RETURNING id")"
    echo "Flash sale: product $PRODUCT_ID, slot $SLOT_ID, $RATE orders per second for 45 seconds"
    limits_off
    docker compose --profile load run --rm \
      -e PRODUCT_ID="$PRODUCT_ID" -e SLOT_ID="$SLOT_ID" -e RATE="$RATE" \
      k6 run /scripts/checkout.js
    ;;
  *)
    echo "Usage: bash scripts/load-test.sh catalog | checkout [orders-per-second]"
    exit 1
    ;;
esac
