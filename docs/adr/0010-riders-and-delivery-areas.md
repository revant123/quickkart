# ADR 0010: Delivery areas, saved addresses and riders

**Status:** accepted

## Context
A dark store can only deliver nearby. Customers need to find the store that delivers to
them, keep addresses, and know who is bringing their order. Several riders at a store see
the same packed orders and may all try to take the same one.

## Decision
- **Distance in SQL, no maps API.** Stores have a location and a `radius_km` (7 km).
  `km_between()` is a small SQL function using the haversine formula. Customers find stores
  by GPS (`navigator.geolocation`) or by pincode; a `pincodes` table holds the centre point
  of every Indian pincode (see "Update" below).
- **The server checks the delivery area at checkout** (`409 outside_delivery_area`). The
  browser runs the same formula first so the customer sees "too far" before submitting.
- **Orders copy the address.** Saved addresses can be edited or deleted; each order keeps the
  text, phone and coordinates it was placed with. One default address per user is enforced
  by a partial unique index (`... ON addresses (user_id) WHERE is_default`).
- **Riders are users with `role = 'rider'` and a `store_id`.** Admins add and remove them;
  the change applies on the rider's next request because sessions are checked against the
  database (ADR 0004).
- **Picking up is a race, solved like the last item in stock (ADR 0002):**
  `UPDATE orders SET rider_id = me, status = 'OUT_FOR_DELIVERY' WHERE id = $1 AND status = 'PACKED'
  AND rider_id IS NULL`. Tested with 5 riders at once: exactly one wins, four get
  `409 already_taken`.
- **Delivering a cash order marks it paid** in the same UPDATE.

## Consequences
- **Good:** no paid maps service, and no new infrastructure.
- **Cost:** straight-line distance, not road distance; a river or a highway can make a
  "3 km" address slow to reach. Good enough for a 7 km radius.
- **Cost:** checking every store's distance is a full scan. Fine for tens of stores; with
  thousands you would add PostGIS and a spatial (GiST) index.
- **Alternatives considered:** Google Maps distance API (cost, a key, a network call per
  checkout); assigning riders automatically (better utilisation, but needs live rider
  locations and is a bigger project).

## Update: stores across India
- **27 stores in 12 cities**, and an admin form that opens a store at any pincode: one
  transaction creates it, stocks it (`stock_store()`, ~60% of the catalogue) and opens slots.
  Stores added by a migration to an existing database are stocked by a background job, so
  the deploy isn't held up by ~800,000 inventory inserts.
- **Pincode data, two sources, measured against known locations:**
  India Post's directory (via IndiaPIN, MIT) covers all ~19,000 pincodes but its post-office
  coordinates were 1-40 km off (one Pune pincode was 690 km off). Per pincode we take the
  median of its post offices and pull outliers back to their district's centre: right town,
  not right street. OpenStreetMap's geocoder (Nominatim) tested at 0.1-2 km, but its policy
  allows 1 request per second, so it's used only for the ~1,600 pincodes near stores,
  fetched once and committed (`scripts/pincodes/osm_points.csv`, ODbL).
- Each pincode and address records whether its point is `precise`. When an approximate
  address looks out of range, checkout suggests "use my exact location" rather than
  silently refusing; the server's distance check itself stays strict.
