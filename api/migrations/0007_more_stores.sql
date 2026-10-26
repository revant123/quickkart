-- 0007 more stores: dark stores across India, not just the Chandigarh tricity.
--
-- stock_store(id) gives a store its own selection of the catalogue (about 60% of products,
-- each with its own price and stock), the same way the sample data does. The admin
-- "Add store" form uses it too.

CREATE OR REPLACE FUNCTION stock_store(p_store BIGINT) RETURNS INTEGER LANGUAGE sql AS $$
  WITH added AS (
    INSERT INTO store_inventory (store_id, product_id, price_paise, stock)
    SELECT p_store, p.id,
           (1500 + random() * 48500)::int,
           CASE WHEN random() < 0.08 THEN 0 ELSE 1 + (random() * 49)::int END
      FROM products p
     WHERE random() < 0.6
    ON CONFLICT DO NOTHING
    RETURNING 1)
  SELECT count(*)::int FROM added;
$$;

-- Existing databases get the new stores here; their stock is filled in by the
-- stock-new-stores job just after start-up (about 30,000 rows per store), so a deploy
-- isn't held up. Fresh databases get every store from db/seed/seed.sql instead.
INSERT INTO stores (name, city, pincode, address, lat, lng)
SELECT v.name, v.city, v.pincode, v.address, v.lat, v.lng
  FROM (VALUES
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
  ('QuickKart Navrangpura', 'Ahmedabad', '380009', 'Navrangpura, Ahmedabad', 23.0365, 72.5611)
  ) AS v(name, city, pincode, address, lat, lng)
 WHERE EXISTS (SELECT 1 FROM products)
   AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.name = v.name);

-- Is an address's map point exact (phone GPS, or a precise pincode centre) or only
-- India Post's estimate for its pincode? Checkout uses it to suggest "use my exact
-- location" when an approximate address looks out of range.
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS precise BOOLEAN NOT NULL DEFAULT true;
