-- Indexes for the queries the app runs.
-- NOTE: the text-search (trigram) index is deliberately NOT here yet.
-- On Day 2 you measure search without it, add it yourself, and measure again.

CREATE INDEX idx_products_category    ON products (category_id);
CREATE INDEX idx_inventory_product    ON store_inventory (product_id);
CREATE INDEX idx_orders_user_time     ON orders (user_id, created_at DESC);
CREATE INDEX idx_orders_store_status  ON orders (store_id, status);
CREATE INDEX idx_idempotency_created  ON idempotency_keys (created_at);
