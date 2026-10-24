-- Day 2 measurement: how does PostgreSQL run the product search?
-- Run from the quickkart folder:
--   docker compose exec -T db psql -U quickkart -d quickkart < db/queries/search-explain.sql
--
-- Read each plan from the most-indented line outwards. Look for:
--   "Seq Scan on products"            = reads ALL 50,000 products and checks each one
--   "Bitmap Index Scan on idx_..._trgm" = uses the trigram index to jump to matches
-- and the "Execution Time" line at the bottom of each plan.

\echo '=== Search 1: "4242" (rare term, matches about 15 products) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.name, si.price_paise
  FROM store_inventory si
  JOIN products p ON p.id = si.product_id
 WHERE si.store_id = 1 AND si.is_listed AND p.name ILIKE '%4242%'
 ORDER BY p.name, p.id
 LIMIT 21;

\echo '=== Search 2: "milk" (common term, matches about 1 in 10 products) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, p.name, si.price_paise
  FROM store_inventory si
  JOIN products p ON p.id = si.product_id
 WHERE si.store_id = 1 AND si.is_listed AND p.name ILIKE '%milk%'
 ORDER BY p.name, p.id
 LIMIT 21;
