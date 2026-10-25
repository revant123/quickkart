-- 0005 product photos: each product kind now has a real photo (Wikimedia Commons,
-- credited at /credits) instead of a drawing. Same file name, .webp instead of .svg.
-- Products with a photo uploaded by staff (/api/products/:id/image) are untouched.
UPDATE products
   SET image_url = regexp_replace(image_url, '\.svg$', '.webp')
 WHERE image_url ~ '^/img/products/[a-z]+\.svg$';
