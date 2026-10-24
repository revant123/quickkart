#!/usr/bin/env bash
# Promotes an existing user to admin. There is deliberately NO API for this:
# nobody should be able to make themselves an admin through the app.
#   bash scripts/make-admin.sh you@example.com
# The change applies on the next request: the role is checked against the database each time.
set -euo pipefail
EMAIL="${1:?usage: bash scripts/make-admin.sh you@example.com}"
PSQL="${PSQL:-docker compose exec -T db psql -U quickkart -d quickkart -Atq}"
RESULT="$($PSQL -c "UPDATE users SET role = 'admin' WHERE email = lower('$EMAIL') RETURNING email")"
if [ -z "$RESULT" ]; then echo "No user with email $EMAIL. Register first."; exit 1; fi
echo "$RESULT is now an admin. Refresh the website: the Admin link appears (no need to log in again)."
