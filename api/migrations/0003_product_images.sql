-- 0003: product pictures.

-- Photos uploaded by store staff. Stored in PostgreSQL (bytea) so the app needs
-- no extra service and works on any host. At larger scale these would move to
-- object storage (S3 / Cloudflare R2) behind a CDN, keeping only the URL here.
CREATE TABLE IF NOT EXISTS product_images (
  product_id   BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  content_type TEXT   NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data         BYTEA  NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every sample product gets the illustration for its kind ("Malai paneer 4242"
-- -> /img/products/paneer.svg). Products without a known kind keep no image.
UPDATE products
   SET image_url = '/img/products/' || substring(name from ' ([a-z]+) [0-9]+$') || '.svg'
 WHERE image_url IS NULL
   AND substring(name from ' ([a-z]+) [0-9]+$') = ANY (ARRAY[
     'milk','curd','paneer','butter','cheese','ghee','lassi','cream',
     'apple','banana','tomato','onion','potato','spinach','mango','carrot',
     'chips','biscuits','namkeen','cookies','popcorn','peanuts','chocolate','wafers',
     'tea','coffee','juice','cola','water','lemonade','soda','shake',
     'rice','atta','dal','sugar','salt','oil','poha','besan']);
