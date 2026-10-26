-- Sample data at a realistic scale: 27 stores in 12 cities, 5 aisles, 50,000 products,
-- ~810,000 store-price-stock rows, and delivery slots for the next 2 days.
--
-- Every product makes sense for its aisle ("Malai paneer 200 g" in Dairy,
-- "Chakki atta 5 kg" in Staples). Names end in a number ("Malai paneer 4242")
-- so each is unique and number searches like "4242" still work.
--
-- Needs the tables first: start the API once (it applies migrations) or run
--   cd api && npm run migrate
-- Fresh database:   docker compose exec -T db psql -U quickkart -d quickkart < db/seed/seed.sql
-- Existing data:    bash scripts/reset-data.sh   (wipes everything, then runs this)

INSERT INTO categories (name, slug) VALUES
  ('Dairy', 'dairy'), ('Fruits & Vegetables', 'fruits-vegetables'),
  ('Snacks', 'snacks'), ('Beverages', 'beverages'), ('Staples', 'staples');

-- Dark stores in 12 cities (same list as scripts/pincodes/stores.json)
INSERT INTO stores (name, city, pincode, address, lat, lng) VALUES
  ('QuickKart Central', 'Chandigarh', '160017', 'Sector 17, Chandigarh', 30.7410, 76.7820),
  ('QuickKart North', 'Chandigarh', '160011', 'Sector 11, Chandigarh', 30.7580, 76.7770),
  ('QuickKart East', 'Mohali', '160062', 'Phase 8, Mohali', 30.7000, 76.7200),
  ('QuickKart Connaught Place', 'New Delhi', '110001', 'Connaught Place, New Delhi', 28.6315, 77.2167),
  ('QuickKart Saket', 'New Delhi', '110017', 'Saket, New Delhi', 28.5245, 77.2066),
  ('QuickKart Cyber City', 'Gurugram', '122002', 'DLF Cyber City, Gurugram', 28.4950, 77.0890),
  ('QuickKart Noida Sector 18', 'Noida', '201301', 'Sector 18, Noida', 28.5708, 77.3261),
  ('QuickKart Andheri', 'Mumbai', '400058', 'Andheri West, Mumbai', 19.1364, 72.8296),
  ('QuickKart Bandra', 'Mumbai', '400050', 'Bandra West, Mumbai', 19.0596, 72.8295),
  ('QuickKart Powai', 'Mumbai', '400076', 'Powai, Mumbai', 19.1176, 72.9060),
  ('QuickKart Koramangala', 'Bengaluru', '560034', 'Koramangala, Bengaluru', 12.9352, 77.6245),
  ('QuickKart Indiranagar', 'Bengaluru', '560038', 'Indiranagar, Bengaluru', 12.9719, 77.6412),
  ('QuickKart Whitefield', 'Bengaluru', '560066', 'Whitefield, Bengaluru', 12.9698, 77.7500),
  ('QuickKart T. Nagar', 'Chennai', '600017', 'T. Nagar, Chennai', 13.0418, 80.2341),
  ('QuickKart Velachery', 'Chennai', '600042', 'Velachery, Chennai', 12.9815, 80.2180),
  ('QuickKart Kattankulathur', 'Chennai', '603203', 'Potheri, near SRM, Kattankulathur', 12.8231, 80.0442),
  ('QuickKart Gachibowli', 'Hyderabad', '500032', 'Gachibowli, Hyderabad', 17.4401, 78.3489),
  ('QuickKart Banjara Hills', 'Hyderabad', '500034', 'Banjara Hills, Hyderabad', 17.4156, 78.4347),
  ('QuickKart Koregaon Park', 'Pune', '411001', 'Koregaon Park, Pune', 18.5362, 73.8940),
  ('QuickKart Hinjewadi', 'Pune', '411057', 'Hinjewadi, Pune', 18.5913, 73.7389),
  ('QuickKart Salt Lake', 'Kolkata', '700091', 'Salt Lake Sector V, Kolkata', 22.5726, 88.4318),
  ('QuickKart Park Street', 'Kolkata', '700016', 'Park Street, Kolkata', 22.5530, 88.3520),
  ('QuickKart Swaroop Nagar', 'Kanpur', '208002', 'Swaroop Nagar, Kanpur', 26.4795, 80.3125),
  ('QuickKart Hazratganj', 'Lucknow', '226001', 'Hazratganj, Lucknow', 26.8467, 80.9462),
  ('QuickKart Gomti Nagar', 'Lucknow', '226010', 'Gomti Nagar, Lucknow', 26.8560, 81.0040),
  ('QuickKart C-Scheme', 'Jaipur', '302001', 'C-Scheme, Jaipur', 26.9066, 75.8000),
  ('QuickKart Navrangpura', 'Ahmedabad', '380009', 'Navrangpura, Ahmedabad', 23.0365, 72.5611);

-- 40 kinds of product (8 per aisle), each with fitting styles and pack sizes.
-- 1,250 numbered variants of each = 50,000 products.
-- Inserted taking one kind from each aisle in turn, so products listed in id
-- order are a natural mix of aisles.
WITH kinds (k, category_slug, noun, styles, units) AS (
  VALUES
  ( 1, 'dairy', 'milk',    ARRAY['Toned','Full cream','Double toned','Farm','Organic'], ARRAY['500 ml','1 l']),
  ( 2, 'dairy', 'curd',    ARRAY['Fresh','Set','Greek','Low fat','Farm'],              ARRAY['400 g','1 kg']),
  ( 3, 'dairy', 'paneer',  ARRAY['Malai','Fresh','Low fat','Organic','Farm'],          ARRAY['200 g','500 g']),
  ( 4, 'dairy', 'butter',  ARRAY['Salted','Unsalted','White','Garlic','Table'],        ARRAY['100 g','500 g']),
  ( 5, 'dairy', 'cheese',  ARRAY['Cheddar','Mozzarella','Processed','Spread','Slice'], ARRAY['200 g','400 g']),
  ( 6, 'dairy', 'ghee',    ARRAY['Desi','Cow','Buffalo','Organic','A2'],               ARRAY['500 ml','1 l']),
  ( 7, 'dairy', 'lassi',   ARRAY['Sweet','Salted','Mango','Rose','Kesar'],             ARRAY['200 ml','1 l']),
  ( 8, 'dairy', 'cream',   ARRAY['Fresh','Whipping','Malai','Cooking','Low fat'],      ARRAY['200 ml','1 l']),

  ( 9, 'fruits-vegetables', 'apple',   ARRAY['Shimla','Kinnaur','Red','Green','Royal'], ARRAY['4 pcs','1 kg']),
  (10, 'fruits-vegetables', 'banana',  ARRAY['Robusta','Yelakki','Raw','Red','Organic'], ARRAY['6 pcs','12 pcs']),
  (11, 'fruits-vegetables', 'tomato',  ARRAY['Desi','Hybrid','Cherry','Organic','Local'], ARRAY['500 g','1 kg']),
  (12, 'fruits-vegetables', 'onion',   ARRAY['Red','White','Spring','Small','Organic'],  ARRAY['1 kg','2 kg']),
  (13, 'fruits-vegetables', 'potato',  ARRAY['New','Baby','Pahadi','Red','Organic'],     ARRAY['1 kg','2 kg']),
  (14, 'fruits-vegetables', 'spinach', ARRAY['Fresh','Baby','Organic','Hydroponic','Local'], ARRAY['250 g','500 g']),
  (15, 'fruits-vegetables', 'mango',   ARRAY['Alphonso','Kesar','Dasheri','Langra','Safeda'], ARRAY['1 kg','3 pcs']),
  (16, 'fruits-vegetables', 'carrot',  ARRAY['Red','Orange','Baby','Organic','Desi'],    ARRAY['500 g','1 kg']),

  (17, 'snacks', 'chips',     ARRAY['Salted','Masala','Cream and onion','Tangy tomato','Peri peri'], ARRAY['52 g','130 g']),
  (18, 'snacks', 'biscuits',  ARRAY['Butter','Cream','Marie','Digestive','Coconut'],  ARRAY['100 g','250 g']),
  (19, 'snacks', 'namkeen',   ARRAY['Aloo','Moong dal','Navratan','Khatta meetha','Bikaneri'], ARRAY['200 g','400 g']),
  (20, 'snacks', 'cookies',   ARRAY['Choco chip','Oatmeal','Butter','Jeera','Nankhatai'], ARRAY['150 g','300 g']),
  (21, 'snacks', 'popcorn',   ARRAY['Salted','Butter','Caramel','Cheese','Masala'],   ARRAY['60 g','120 g']),
  (22, 'snacks', 'peanuts',   ARRAY['Roasted','Salted','Masala','Honey','Coated'],    ARRAY['200 g','500 g']),
  (23, 'snacks', 'chocolate', ARRAY['Milk','Dark','Fruit and nut','Almond','White'],  ARRAY['50 g','150 g']),
  (24, 'snacks', 'wafers',    ARRAY['Vanilla','Chocolate','Strawberry','Orange','Lemon'], ARRAY['75 g','150 g']),

  (25, 'beverages', 'tea',       ARRAY['Assam','Darjeeling','Masala','Green','Ginger'], ARRAY['250 g','500 g']),
  (26, 'beverages', 'coffee',    ARRAY['Filter','Instant','Cold brew','South Indian','Classic'], ARRAY['100 g','200 g']),
  (27, 'beverages', 'juice',     ARRAY['Orange','Mixed fruit','Guava','Litchi','Apple'], ARRAY['200 ml','1 l']),
  (28, 'beverages', 'cola',      ARRAY['Classic','Diet','Zero sugar','Lemon','Cherry'],  ARRAY['300 ml','750 ml']),
  (29, 'beverages', 'water',     ARRAY['Mineral','Packaged','Sparkling','Alkaline','Spring'], ARRAY['500 ml','1 l']),
  (30, 'beverages', 'lemonade',  ARRAY['Classic','Mint','Ginger','Pink','Shikanji'],     ARRAY['250 ml','1 l']),
  (31, 'beverages', 'soda',      ARRAY['Club','Masala','Lime','Ginger','Jeera'],         ARRAY['250 ml','750 ml']),
  (32, 'beverages', 'shake',     ARRAY['Chocolate','Strawberry','Badam','Kesar','Banana'], ARRAY['180 ml','1 l']),

  (33, 'staples', 'rice',   ARRAY['Basmati','Sona masoori','Brown','Kolam','Jeera'],   ARRAY['1 kg','5 kg']),
  (34, 'staples', 'atta',   ARRAY['Chakki','Multigrain','Whole wheat','Organic','Sharbati'], ARRAY['1 kg','5 kg']),
  (35, 'staples', 'dal',    ARRAY['Toor','Moong','Masoor','Chana','Urad'],             ARRAY['500 g','1 kg']),
  (36, 'staples', 'sugar',  ARRAY['White','Brown','Jaggery','Organic','Mishri'],       ARRAY['500 g','1 kg']),
  (37, 'staples', 'salt',   ARRAY['Iodised','Rock','Black','Sea','Pink'],              ARRAY['500 g','1 kg']),
  (38, 'staples', 'oil',    ARRAY['Mustard','Sunflower','Groundnut','Rice bran','Olive'], ARRAY['1 l','5 l']),
  (39, 'staples', 'poha',   ARRAY['Thick','Thin','Red','Brown','Organic'],             ARRAY['500 g','1 kg']),
  (40, 'staples', 'besan',  ARRAY['Fine','Coarse','Organic','Chakki','Classic'],       ARRAY['500 g','1 kg'])
),
numbered AS (
  -- g runs 1..50000, taking one kind from each aisle in turn:
  -- milk, apple, chips, tea, rice, curd, banana, biscuits, coffee, atta, ...
  SELECT row_number() OVER (ORDER BY s, (k.k - 1) % 8, (k.k - 1) / 8) AS g, s, k.*
  FROM generate_series(1, 1250) AS s
  CROSS JOIN kinds k
)
INSERT INTO products (category_id, name, unit, image_url)
SELECT c.id,
       n.styles[1 + (n.s % 5)] || ' ' || n.noun || ' ' || n.g,
       n.units[1 + ((n.s / 5) % 2)],
       '/img/products/' || n.noun || '.webp'  -- photo of its kind (credits: /credits)
FROM numbered n
JOIN categories c ON c.slug = n.category_slug
ORDER BY n.g;

-- Each store stocks about 60% of products, at its own price and stock level.
-- About 1 in 12 stocked items is sold out, so "Sold out" shows up while browsing.
INSERT INTO store_inventory (store_id, product_id, price_paise, stock)
SELECT s.id, p.id,
       (1500 + random() * 48500)::int,
       CASE WHEN random() < 0.08 THEN 0 ELSE 1 + (random() * 49)::int END
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
