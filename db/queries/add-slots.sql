-- Creates 30-minute delivery slots (capacity 5) for every store,
-- from the next hour for the next 2 days. Safe to run any number of times:
-- slots that already exist are skipped.
--   docker compose exec -T db psql -U quickkart -d quickkart < db/queries/add-slots.sql

INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity)
SELECT s.id, t, t + interval '30 minutes', 5
FROM stores s,
     generate_series(date_trunc('hour', now()) + interval '1 hour',
                     date_trunc('hour', now()) + interval '2 days',
                     interval '30 minutes') AS t
ON CONFLICT (store_id, starts_at) DO NOTHING;
