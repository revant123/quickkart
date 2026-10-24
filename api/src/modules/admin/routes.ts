import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db.js';
import { HttpError } from '../../errors.js';
import { cancelOrder, getOrder } from '../orders/queries.js';
import { bumpCatalogVersion } from '../../cache.js';

// Mounted in app.ts behind requireAuth + requireRole('admin'):
// a customer gets 403, a logged-out visitor gets 401, for every route below.
export const adminRouter = Router();

const Id = z.coerce.number().int().positive();

/** 404 unless the store exists (active or not: admins manage closed stores too). */
async function assertStore(storeId: number) {
  const { rowCount } = await pool.query('SELECT 1 FROM stores WHERE id = $1', [storeId]);
  if (rowCount === 0) throw new HttpError(404, 'store_not_found');
}

// ===========================================================================
// INVENTORY
// ===========================================================================

const InventoryQuery = z.object({
  q: z.string().trim().min(1).max(60).optional(),
  lowStockBelow: z.coerce.number().int().min(1).max(10000).optional(),
  afterId: z.coerce.number().int().min(0).default(0), // keyset pagination by product id
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// GET /api/admin/stores/:storeId/inventory?q=milk&lowStockBelow=5&afterId=0&limit=50
adminRouter.get('/stores/:storeId/inventory', async (req, res) => {
  const storeId = Id.parse(req.params.storeId);
  const { q, lowStockBelow, afterId, limit } = InventoryQuery.parse(req.query);
  await assertStore(storeId);

  const params: unknown[] = [storeId, afterId, limit + 1];
  const where = ['si.store_id = $1', 'si.product_id > $2'];
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }
  if (lowStockBelow) {
    params.push(lowStockBelow);
    where.push(`si.stock < $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT si.product_id, p.name, p.unit, c.name AS category,
            si.price_paise, si.stock, si.is_listed, si.updated_at
       FROM store_inventory si
       JOIN products p   ON p.id = si.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY si.product_id
      LIMIT $3`,
    params,
  );
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  res.json({ items, nextAfterId: hasMore ? Number(items.at(-1).product_id) : null });
});

const InventoryPatch = z
  .object({
    pricePaise: z.number().int().positive().max(10_000_000).optional(),
    isListed: z.boolean().optional(),
    // RELATIVE change ("24 arrived" = +24, "3 damaged" = -3), never an absolute value.
    // Setting "stock = 30" from a screen opened 5 minutes ago would erase sales made
    // since then: the lost-update bug again, caused by a human this time.
    adjustStockBy: z.number().int().min(-100_000).max(100_000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to update' });

// PATCH /api/admin/stores/:storeId/inventory/:productId
adminRouter.patch('/stores/:storeId/inventory/:productId', async (req, res) => {
  const storeId = Id.parse(req.params.storeId);
  const productId = Id.parse(req.params.productId);
  const body = InventoryPatch.parse(req.body);
  try {
    const { rows } = await pool.query(
      `UPDATE store_inventory
          SET price_paise = COALESCE($3, price_paise),
              is_listed   = COALESCE($4, is_listed),
              stock       = stock + COALESCE($5, 0),
              updated_at  = now()
        WHERE store_id = $1 AND product_id = $2
        RETURNING product_id, price_paise, stock, is_listed, updated_at`,
      [storeId, productId, body.pricePaise ?? null, body.isListed ?? null, body.adjustStockBy ?? null],
    );
    if (!rows[0]) throw new HttpError(404, 'inventory_not_found');
    await bumpCatalogVersion(storeId); // shop pages for this store show the change at once
    res.json(rows[0]);
  } catch (e: any) {
    // 23514 = check_violation: CHECK (stock >= 0) refused it
    if (e.code === '23514') throw new HttpError(409, 'stock_would_go_negative');
    throw e;
  }
});

// ===========================================================================
// DELIVERY SLOTS
// ===========================================================================

const NewSlot = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(240).default(30),
  capacity: z.number().int().min(1).max(1000),
});

// POST /api/admin/stores/:storeId/slots  { startsAt, durationMinutes?, capacity }
adminRouter.post('/stores/:storeId/slots', async (req, res) => {
  const storeId = Id.parse(req.params.storeId);
  const body = NewSlot.parse(req.body);
  if (body.startsAt.getTime() <= Date.now()) throw new HttpError(400, 'slot_in_past');
  await assertStore(storeId);
  try {
    const { rows } = await pool.query(
      `INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity)
       VALUES ($1, $2, $2::timestamptz + make_interval(mins => $3), $4)
       RETURNING id, store_id, starts_at, ends_at, capacity, booked`,
      [storeId, body.startsAt, body.durationMinutes, body.capacity],
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'slot_exists'); // unique (store_id, starts_at)
    throw e;
  }
});

// ===========================================================================
// ORDERS
// ===========================================================================

const STATUSES = ['PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const;

const OrdersQuery = z.object({
  storeId: z.coerce.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
});

// GET /api/admin/orders?storeId=1&status=PLACED  (uses index idx_orders_store_status)
adminRouter.get('/orders', async (req, res) => {
  const { storeId, status } = OrdersQuery.parse(req.query);
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.total_paise, o.created_at, o.store_id, s.name AS store_name,
            u.email AS customer_email, ds.starts_at AS slot_start,
            (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o
       JOIN stores s          ON s.id = o.store_id
       JOIN users u           ON u.id = o.user_id
       JOIN delivery_slots ds ON ds.id = o.slot_id
      WHERE ($1::bigint IS NULL OR o.store_id = $1)
        AND ($2::text   IS NULL OR o.status = $2)
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT 100`,
    [storeId ?? null, status ?? null],
  );
  res.json(rows);
});

// GET /api/admin/orders/:id -> any order, with items
adminRouter.get('/orders/:id', async (req, res) => {
  res.json(await getOrder(Id.parse(req.params.id)));
});

/**
 * Order status is a state machine. Each target status lists the ONLY states it may
 * come from. Enforced inside the UPDATE itself (same pattern as stock):
 *   PLACED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED,  PLACED/PACKED -> CANCELLED
 */
const ALLOWED_FROM: Record<string, string[]> = {
  PACKED: ['PLACED'],
  OUT_FOR_DELIVERY: ['PACKED'],
  DELIVERED: ['OUT_FOR_DELIVERY'],
};
const StatusBody = z.object({ status: z.enum(['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']) });

// PATCH /api/admin/orders/:id/status { status }  -> 200 | 404 | 409 illegal transition
adminRouter.patch('/orders/:id/status', async (req, res) => {
  const orderId = Id.parse(req.params.id);
  const { status: next } = StatusBody.parse(req.body);

  // Cancelling also returns stock and the slot place, so it has its own transaction
  if (next === 'CANCELLED') {
    res.json(await cancelOrder(orderId));
    return;
  }

  const { rows } = await pool.query(
    `UPDATE orders SET status = $2
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING id, status`,
    [orderId, next, ALLOWED_FROM[next]],
  );
  if (rows[0]) {
    res.json(rows[0]);
    return;
  }
  const { rows: found } = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (!found[0]) throw new HttpError(404, 'order_not_found');
  throw new HttpError(409, 'illegal_transition', { from: found[0].status, to: next });
});

// ===========================================================================
// REPORTS (for the admin dashboard)
// ===========================================================================

const DAY = 24 * 60 * 60 * 1000;
const SalesQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// GET /api/admin/reports/sales?from=2026-10-01&to=2026-10-31 (default: last 7 days)
// Revenue and order count per store per day, cancelled orders excluded.
adminRouter.get('/reports/sales', async (req, res) => {
  const q = SalesQuery.parse(req.query);
  const to = q.to ?? new Date(Date.now() + DAY);
  const from = q.from ?? new Date(to.getTime() - 8 * DAY);
  if (from >= to) throw new HttpError(400, 'from_must_be_before_to');
  const { rows } = await pool.query(
    `SELECT s.id AS store_id, s.name AS store,
            date_trunc('day', o.created_at) AS day,
            count(*)::int AS orders,
            sum(o.total_paise)::float8 AS revenue_paise
       FROM orders o
       JOIN stores s ON s.id = o.store_id
      WHERE o.status <> 'CANCELLED' AND o.created_at >= $1 AND o.created_at < $2
      GROUP BY s.id, s.name, day
      ORDER BY day DESC, revenue_paise DESC`,
    [from, to],
  );
  res.json(rows);
});

const StoreDaysQuery = z.object({
  storeId: z.coerce.number().int().positive(),
  days: z.coerce.number().int().min(1).max(365).default(7),
});

// GET /api/admin/reports/top-products?storeId=1&days=7 -> 10 best sellers by units
adminRouter.get('/reports/top-products', async (req, res) => {
  const { storeId, days } = StoreDaysQuery.parse(req.query);
  const { rows } = await pool.query(
    `SELECT p.id AS product_id, p.name,
            sum(oi.quantity)::int AS units_sold,
            sum(oi.quantity * oi.unit_price_paise)::float8 AS revenue_paise
       FROM order_items oi
       JOIN orders o   ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
      WHERE o.store_id = $1 AND o.status <> 'CANCELLED'
        AND o.created_at >= now() - make_interval(days => $2)
      GROUP BY p.id, p.name
      ORDER BY units_sold DESC, p.name
      LIMIT 10`,
    [storeId, days],
  );
  res.json(rows);
});

// GET /api/admin/reports/slots?storeId=1 -> booked vs capacity for the next 24 hours
adminRouter.get('/reports/slots', async (req, res) => {
  const storeId = z.coerce.number().int().positive().parse(req.query.storeId);
  const { rows } = await pool.query(
    `SELECT id, starts_at, ends_at, capacity, booked,
            round(booked * 100.0 / capacity)::int AS utilisation_pct
       FROM delivery_slots
      WHERE store_id = $1 AND starts_at > now() AND starts_at < now() + interval '24 hours'
      ORDER BY starts_at`,
    [storeId],
  );
  res.json(rows);
});
