import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db.js';
import { HttpError } from '../../errors.js';
import { cached, catalogVersion } from '../../cache.js';
import { openStream, stockView } from '../../live.js';

export const catalogRouter = Router();

const StoreId = z.coerce.number().int().positive();

// GET /api/stores -> active stores
catalogRouter.get('/stores', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, city, pincode FROM stores WHERE is_active ORDER BY name',
  );
  res.json(rows);
});

// GET /api/categories -> all categories
catalogRouter.get('/categories', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, slug FROM categories ORDER BY name');
  res.json(rows);
});

/** 404 unless the store exists and is active. */
async function assertStore(storeId: number) {
  const { rowCount } = await pool.query('SELECT 1 FROM stores WHERE id = $1 AND is_active', [
    storeId,
  ]);
  if (rowCount === 0) throw new HttpError(404, 'store_not_found');
}

// GET /api/stores/:storeId/slots -> upcoming delivery slots that still have room
catalogRouter.get('/stores/:storeId/slots', async (req, res) => {
  const storeId = StoreId.parse(req.params.storeId);
  await assertStore(storeId);
  const { rows } = await pool.query(
    `SELECT id, starts_at, ends_at, capacity - booked AS free
       FROM delivery_slots
      WHERE store_id = $1 AND starts_at > now() AND booked < capacity
      ORDER BY starts_at
      LIMIT 12`,
    [storeId],
  );
  res.json(rows);
});

// GET /api/stores/:storeId/live -> Server-Sent Events for one store:
//   event: stock  data: [{ productId, in_stock, low_stock, price_paise?, listed? }]
//   event: slot   data: { slotId, free }
// Customers see stock as in/out plus a count only when it's low, never exact numbers.
catalogRouter.get('/stores/:storeId/live', async (req, res) => {
  const storeId = StoreId.parse(req.params.storeId);
  await assertStore(storeId);
  openStream(req, res, (e) => {
    if (e.storeId !== storeId) return null;
    if (e.type === 'stock') {
      return {
        event: 'stock',
        data: e.items.map((i) => ({
          productId: i.productId,
          ...stockView(i.stock),
          ...(i.pricePaise !== undefined && { price_paise: i.pricePaise }),
          ...(i.listed !== undefined && { listed: i.listed }),
        })),
      };
    }
    if (e.type === 'slot') return { event: 'slot', data: { slotId: e.slotId, free: e.free } };
    return null; // order events are private
  });
});

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/products?q=milk&category=dairy&limit=20&cursor=...
//
// Search + filter + KEYSET pagination.
//   Offset pagination (OFFSET 10000) makes the database read and throw away
//   10,000 rows, and shows duplicates if rows are inserted while scrolling.
//   Keyset pagination remembers the last row seen and asks for rows AFTER it,
//   so every page costs the same.
//
// Two orders:
//   searching (q given) -> A to Z by (name, id); `id` breaks ties between equal names
//   browsing  (no q)    -> catalogue order by product id, which mixes aisles and
//                          products, and walks the store_inventory primary key index
// ---------------------------------------------------------------------------

const ProductQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
});

// name is only present for search cursors
const Cursor = z.object({ id: z.string(), name: z.string().optional() });
type Cursor = z.infer<typeof Cursor>;

/** In LIKE patterns, % and _ are wildcards. Escape them so "100%" means the text "100%". */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decodeCursor(s: string): Cursor {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')));
  } catch {
    throw new HttpError(400, 'bad_cursor');
  }
}

catalogRouter.get('/stores/:storeId/products', async (req, res) => {
  const storeId = StoreId.parse(req.params.storeId);
  const query = ProductQuery.parse(req.query);

  // Cache-aside (see src/cache.ts). The key holds every input that changes the
  // answer, plus the store's catalog version (bumped when an admin edits stock).
  const version = await catalogVersion(storeId);
  const key = `catalog:${storeId}:v${version}:${JSON.stringify(query)}`;
  const { value, status } = await cached(key, () => loadProducts(storeId, query));

  // The cache holds the EXPENSIVE part (search, filter, sort). Stock and price
  // change every second, so they're read fresh for just these ~24 rows: one
  // primary-key lookup. The page is never stale about what you can buy.
  const ids = value.items.map((p: { id: string }) => p.id);
  const fresh = ids.length
    ? await pool.query(
        `SELECT product_id, stock, price_paise FROM store_inventory
          WHERE store_id = $1 AND product_id = ANY($2::bigint[])`,
        [storeId, ids],
      )
    : { rows: [] };
  const byId = new Map(fresh.rows.map((r) => [String(r.product_id), r]));
  const items = value.items.map((p: { id: string }) => {
    const f = byId.get(String(p.id));
    return f ? { ...p, price_paise: f.price_paise, ...stockView(f.stock) } : p;
  });

  res.set('X-Cache', status); // HIT / MISS / OFF: visible in the browser's network tab
  res.json({ ...value, items });
});

async function loadProducts(storeId: number, { q, category, limit, cursor }: z.infer<typeof ProductQuery>) {
  await assertStore(storeId);

  // Only these fixed SQL fragments are ever joined together.
  // Every user-supplied VALUE goes through a $n placeholder (no SQL injection).
  const where = ['si.store_id = $1', 'si.is_listed'];
  const params: unknown[] = [storeId];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (q) where.push(`p.name ILIKE ${param(`%${escapeLike(q)}%`)}`);
  if (category) where.push(`c.slug = ${param(category)}`);
  const byName = Boolean(q);
  if (cursor) {
    const c = decodeCursor(cursor);
    if (byName) {
      if (c.name === undefined) throw new HttpError(400, 'bad_cursor');
      where.push(`(p.name, p.id) > (${param(c.name)}, ${param(c.id)})`);
    } else {
      where.push(`si.product_id > ${param(c.id)}`);
    }
  }
  // Fetch one extra row: if it comes back, there is a next page.
  const limitParam = param(limit + 1);

  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.unit, p.image_url, c.slug AS category,
            si.price_paise, si.stock
       FROM store_inventory si
       JOIN products   p ON p.id = si.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${byName ? 'p.name, p.id' : 'si.product_id'}
      LIMIT ${limitParam}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  // Never expose exact stock: in/out, plus a count only when it's low
  const items = page.map(({ stock, ...p }) => ({ ...p, ...stockView(stock) }));
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor(byName ? { id: String(last.id), name: last.name } : { id: String(last.id) })
        : null,
  };
}
