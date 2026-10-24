-- Day 2: trigram index for product-name search.
--
-- A normal (B-tree) index cannot help  name ILIKE '%term%'  because the term can
-- start anywhere in the name. A trigram index splits every name into 3-letter
-- chunks ("mil", "ilk", ...) so PostgreSQL can quickly find names containing
-- the search term's chunks.
--
-- On a FRESH database this runs automatically. On your existing database,
-- run it by hand AFTER measuring search speed without it (see docs/day2-tasks.md).

CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
ANALYZE products;
