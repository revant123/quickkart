import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { HttpError } from '../../errors.js';
import { notifyLive, openStream } from '../../live.js';
import { notifyOrder } from '../../notifications/outbox.js';

// ---------------------------------------------------------------------------
// Delivery riders. Each rider works for ONE store (users.store_id). Mounted
// behind requireAuth + requireRole('rider').
//
//   PACKED (no rider) --pick up--> OUT_FOR_DELIVERY (this rider) --deliver--> DELIVERED
//
// Picking up is a race: several riders see the same packed order and tap
// "Pick up" together. One conditional UPDATE decides it, the same pattern as the
// last item in stock: "... WHERE status = 'PACKED' AND rider_id IS NULL".
// The first UPDATE locks the row; the others wait, re-check, match nothing, 409.
// ---------------------------------------------------------------------------

export const riderRouter = Router();
const Id = z.coerce.number().int().positive();

const RIDER_ORDER = `
  SELECT o.id, o.status, o.total_paise, o.address, o.phone, o.delivery_lat, o.delivery_lng,
         o.payment_method, o.payment_status, o.picked_up_at, o.created_at,
         ds.starts_at AS slot_start, ds.ends_at AS slot_end, u.name AS customer_name,
         (SELECT coalesce(sum(quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
    FROM orders o
    JOIN delivery_slots ds ON ds.id = o.slot_id
    JOIN users u ON u.id = o.user_id`;

// GET /api/rider/orders -> { ready: packed orders nobody has taken, mine: on my bike now }
riderRouter.get('/orders', async (req, res) => {
  const me = req.user!;
  const [ready, mine, store] = await Promise.all([
    pool.query(
      `${RIDER_ORDER} WHERE o.store_id = $1 AND o.status = 'PACKED' AND o.rider_id IS NULL
        ORDER BY ds.starts_at, o.id LIMIT 50`,
      [me.storeId],
    ),
    pool.query(`${RIDER_ORDER} WHERE o.rider_id = $1 AND o.status = 'OUT_FOR_DELIVERY' ORDER BY o.picked_up_at`, [me.id]),
    pool.query('SELECT id, name, address, lat, lng FROM stores WHERE id = $1', [me.storeId]),
  ]);
  res.json({ store: store.rows[0], ready: ready.rows, mine: mine.rows });
});

// GET /api/rider/live -> Server-Sent Events: order changes at my store
riderRouter.get('/live', (req, res) => {
  const storeId = req.user!.storeId;
  openStream(req, res, (e) =>
    e.type === 'order' && e.storeId === storeId
      ? { event: 'order', data: { orderId: e.orderId, status: e.status } }
      : null,
  );
});

// POST /api/rider/orders/:id/pickup -> 200 | 409 already_taken (another rider won)
riderRouter.post('/orders/:id/pickup', async (req, res) => {
  const orderId = Id.parse(req.params.id);
  const me = req.user!;
  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE orders SET status = 'OUT_FOR_DELIVERY', rider_id = $2, picked_up_at = now()
        WHERE id = $1 AND store_id = $3 AND status = 'PACKED' AND rider_id IS NULL
        RETURNING id, store_id, user_id`,
      [orderId, me.id, me.storeId],
    );
    if (!rows[0]) return null;
    await notifyOrder(db, rows[0].id, 'order_out_for_delivery'); // email + SMS with the rider's name
    await notifyLive(db, {
      type: 'order', storeId: Number(rows[0].store_id), userId: Number(rows[0].user_id),
      orderId: Number(rows[0].id), status: 'OUT_FOR_DELIVERY',
    });
    return rows[0];
  });
  if (!row) {
    const { rows } = await pool.query('SELECT status, rider_id FROM orders WHERE id = $1 AND store_id = $2', [
      orderId, me.storeId,
    ]);
    if (!rows[0]) throw new HttpError(404, 'order_not_found');
    throw new HttpError(409, rows[0].rider_id ? 'already_taken' : 'not_ready', { status: rows[0].status });
  }
  res.json({ id: String(row.id), status: 'OUT_FOR_DELIVERY' });
});

// POST /api/rider/orders/:id/deliver -> 200 | 404 not mine | 409 not out for delivery
// Cash on delivery: handing over the order means the cash was collected, so it's paid.
riderRouter.post('/orders/:id/deliver', async (req, res) => {
  const orderId = Id.parse(req.params.id);
  const me = req.user!;
  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE orders SET status = 'DELIVERED', delivered_at = now(),
              payment_status = CASE WHEN payment_method = 'cod' THEN 'paid' ELSE payment_status END
        WHERE id = $1 AND rider_id = $2 AND status = 'OUT_FOR_DELIVERY'
        RETURNING id, store_id, user_id`,
      [orderId, me.id],
    );
    if (!rows[0]) return null;
    await notifyOrder(db, rows[0].id, 'order_delivered');
    await notifyLive(db, {
      type: 'order', storeId: Number(rows[0].store_id), userId: Number(rows[0].user_id),
      orderId: Number(rows[0].id), status: 'DELIVERED',
    });
    return rows[0];
  });
  if (!row) {
    const { rows } = await pool.query('SELECT status FROM orders WHERE id = $1 AND rider_id = $2', [orderId, me.id]);
    if (!rows[0]) throw new HttpError(404, 'order_not_found');
    throw new HttpError(409, 'not_out_for_delivery', { status: rows[0].status });
  }
  res.json({ id: String(row.id), status: 'DELIVERED' });
});

// ===========================================================================
// Admin: managing riders (mounted under /api/admin)
// ===========================================================================

export const adminRidersRouter = Router();

// GET /api/admin/riders -> every rider with their store and deliveries today
adminRidersRouter.get('/riders', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.store_id, s.name AS store_name,
            count(o.id) FILTER (WHERE o.status = 'OUT_FOR_DELIVERY')::int AS on_the_way,
            count(o.id) FILTER (WHERE o.status = 'DELIVERED' AND o.delivered_at >= date_trunc('day', now()))::int AS delivered_today
       FROM users u
       JOIN stores s ON s.id = u.store_id
       LEFT JOIN orders o ON o.rider_id = u.id
      WHERE u.role = 'rider'
      GROUP BY u.id, s.name
      ORDER BY s.name, u.name`,
  );
  res.json(rows);
});

// POST /api/admin/riders { email, storeId } -> makes an existing customer a rider
// 200 | 404 user_not_found / store_not_found | 409 cannot_change_admin
const NewRider = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  storeId: z.number().int().positive(),
});
adminRidersRouter.post('/riders', async (req, res) => {
  const body = NewRider.parse(req.body);
  const { rowCount: storeOk } = await pool.query('SELECT 1 FROM stores WHERE id = $1', [body.storeId]);
  if (!storeOk) throw new HttpError(404, 'store_not_found');
  const { rows } = await pool.query(
    `UPDATE users SET role = 'rider', store_id = $2 WHERE email = $1 AND role <> 'admin'
     RETURNING id, name, email, store_id`,
    [body.email, body.storeId],
  );
  if (!rows[0]) {
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
    throw rowCount ? new HttpError(409, 'cannot_change_admin') : new HttpError(404, 'user_not_found');
  }
  res.json(rows[0]); // takes effect on the rider's next request (role is checked every time)
});

// DELETE /api/admin/riders/:id -> back to customer | 409 rider_has_deliveries
adminRidersRouter.delete('/riders/:id', async (req, res) => {
  const id = Id.parse(req.params.id);
  const { rows } = await pool.query(
    `UPDATE users SET role = 'customer', store_id = NULL
      WHERE id = $1 AND role = 'rider'
        AND NOT EXISTS (SELECT 1 FROM orders WHERE rider_id = $1 AND status = 'OUT_FOR_DELIVERY')
      RETURNING id`,
    [id],
  );
  if (!rows[0]) {
    const { rows: u } = await pool.query(`SELECT role FROM users WHERE id = $1`, [id]);
    if (!u[0] || u[0].role !== 'rider') throw new HttpError(404, 'rider_not_found');
    throw new HttpError(409, 'rider_has_deliveries');
  }
  res.status(204).end();
});
