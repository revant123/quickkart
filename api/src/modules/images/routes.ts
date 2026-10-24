import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../../db.js';
import { HttpError } from '../../errors.js';
import { bumpCatalogVersion } from '../../cache.js';

// ---------------------------------------------------------------------------
// Product photos. Staff upload a JPEG/PNG/WebP (max 1 MB); it's stored in
// PostgreSQL and served with long-lived cache headers. The URL carries a
// version (?v=...), so a new upload gets a new URL and browsers never show a
// stale photo, while unchanged photos are cached for a year.
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 1024 * 1024;
const Id = z.coerce.number().int().positive();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

/**
 * Identify the file by its first bytes ("magic numbers"), never by the file
 * name or the Content-Type the browser claims, which anyone can fake.
 */
export function sniffImageType(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

/** The built-in illustration for a sample product, or null. Same rule as migration 0003. */
const ILLUSTRATION_SQL = `CASE WHEN substring(name from ' ([a-z]+) [0-9]+$') IS NOT NULL
  THEN '/img/products/' || substring(name from ' ([a-z]+) [0-9]+$') || '.svg' END`;

async function bumpAllStores() {
  // A product's picture shows in every store, so every store's cached pages change
  const { rows } = await pool.query('SELECT id FROM stores');
  await Promise.all(rows.map((r) => bumpCatalogVersion(Number(r.id))));
}

// ---- Public: GET /api/products/:id/image ---------------------------------------
export const publicImagesRouter = Router();

publicImagesRouter.get('/products/:id/image', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT content_type, data FROM product_images WHERE product_id = $1',
    [Id.parse(req.params.id)],
  );
  if (!rows[0]) throw new HttpError(404, 'image_not_found');
  res.set({
    'Content-Type': rows[0].content_type,
    'Cache-Control': 'public, max-age=31536000, immutable', // the URL changes when the photo does
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'", // an image, never a page
  });
  res.send(rows[0].data);
});

// ---- Admin: upload / remove ------------------------------------------------------
export const adminImagesRouter = Router();

// POST /api/admin/products/:id/image   (multipart form, field "image")
adminImagesRouter.post('/products/:id/image', upload.single('image'), async (req, res) => {
  const productId = Id.parse(req.params.id);
  if (!req.file) throw new HttpError(400, 'image_required');
  const type = sniffImageType(req.file.buffer);
  if (!type) throw new HttpError(415, 'unsupported_image_type');

  const { rowCount } = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId]);
  if (!rowCount) throw new HttpError(404, 'product_not_found');

  await pool.query(
    `INSERT INTO product_images (product_id, content_type, data) VALUES ($1, $2, $3)
     ON CONFLICT (product_id) DO UPDATE
       SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = now()`,
    [productId, type, req.file.buffer],
  );
  const imageUrl = `/api/products/${productId}/image?v=${Date.now()}`;
  await pool.query('UPDATE products SET image_url = $2 WHERE id = $1', [productId, imageUrl]);
  await bumpAllStores();
  res.status(201).json({ image_url: imageUrl });
});

// DELETE /api/admin/products/:id/image  -> back to the illustration (or no picture)
adminImagesRouter.delete('/products/:id/image', async (req, res) => {
  const productId = Id.parse(req.params.id);
  await pool.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  const { rows } = await pool.query(
    `UPDATE products SET image_url = ${ILLUSTRATION_SQL} WHERE id = $1 RETURNING image_url`,
    [productId],
  );
  if (!rows[0]) throw new HttpError(404, 'product_not_found');
  await bumpAllStores();
  res.json({ image_url: rows[0].image_url });
});
