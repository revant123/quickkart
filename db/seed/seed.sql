-- Sample data at a realistic scale: 3 stores, 5 categories, 50,000 products,
-- ~90,000 inventory rows, and delivery slots for the next 2 days.
-- Run (from the quickkart folder):
--   docker compose exec -T db psql -U quickkart -d quickkart < db/seed/seed.sql

INSERT INTO categories (name, slug) VALUES
  ('Dairy', 'dairy'), ('Fruits & Vegetables', 'fruits-vegetables'),
  ('Snacks', 'snacks'), ('Beverages', 'beverages'), ('Staples', 'staples');

INSERT INTO stores (name, city, pincode) VALUES
  ('QuickKart Central', 'Chandigarh', '160017'),
  ('QuickKart North',   'Chandigarh', '160011'),
  ('QuickKart East',    'Mohali',     '160062');

-- Names look like 'Organic paneer 4242'
INSERT INTO products (category_id, name, unit)
SELECT 1 + (g % 5),
       (ARRAY['Fresh','Organic','Classic','Premium','Daily'])[1 + (g % 5)] || ' ' ||
       (ARRAY['milk','bread','apple','chips','juice','rice','paneer','banana',
              'biscuit','tea'])[1 + (g / 5 % 10)] || ' ' || g,
       (ARRAY['500 g','1 kg','1 l','6 pcs'])[1 + (g % 4)]
FROM generate_series(1, 50000) AS g;

-- Each store stocks about 60% of products, at its own price and stock level
INSERT INTO store_inventory (store_id, product_id, price_paise, stock)
SELECT s.id, p.id, 1000 + (random() * 49000)::int, (random() * 50)::int
FROM stores s CROSS JOIN products p
WHERE random() < 0.6;

-- 30-minute delivery slots, capacity 5, from the next hour for 2 days
INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity)
SELECT s.id, t, t + interval '30 minutes', 5
FROM stores s,
     generate_series(date_trunc('hour', now()) + interval '1 hour',
                     date_trunc('hour', now()) + interval '2 days',
                     interval '30 minutes') AS t;

ANALYZE;   -- refresh the query planner's statistics after a bulk load
