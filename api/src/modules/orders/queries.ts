import { pool, withTransaction, withRetry } from '../../db.js';
import { HttpError } from '../../errors.js';
import { notifyLive, type StockItem } from '../../live.js';

/**
 * Orders with their items folded into one JSON array (json_agg), so the API
 * returns each order with its items in ONE query instead of 1 + N queries.
 * GROUP BY o.id lets us select every orders column because id is its primary key.
 */
const ORDER_SELECT = `
  SELECT o.id, o.status, o.total_paise, o.address, o.created_at,
         o.store_id, s.name AS store_name,
         ds.starts_at AS slot_start, ds.ends_at AS slot_end,
         json_agg(json_build_object(
           'productId', oi.product_id, 'name', p.name, 'unit', p.unit,
           'quantity', oi.quantity, 'unitPricePaise', oi.unit_price_paise)
           ORDER BY p.name) AS items
    FROM orders o
    JOIN stores s          ON s.id = o.store_id
    JOIN delivery_slots ds ON ds.id = o.slot_id
    JOIN order_items oi    ON oi.order_id = o.id
    JOIN products p        ON p.id = oi.product_id`;

const ORDER_GROUP = `GROUP BY o.id, s.name, ds.starts_at, ds.ends_at`;

/** A customer's most recent orders (uses index idx_orders_user_time). */
export async function listOrdersForUser(userId: number) {
  const { rows } = await pool.query(
    `${ORDER_SELECT}
     WHERE o.user_id = $1
     ${ORDER_GROUP}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT 50`,
    [userId],
  );
  return rows;
}

/**
 * One order. If userId is given, the order must belong to that user.
 * Someone else's order gives 404, not 403: a 403 would confirm the order exists.
 */
export async function getOrder(orderId: number, userId?: number) {
  const { rows } = await pool.query(
    `${ORDER_SELECT}
     WHERE o.id = $1 AND ($2::bigint IS NULL OR o.user_id = $2)
     ${ORDER_GROUP}`,
    [orderId, userId ?? null],
  );
  if (!rows[0]) throw new HttpError(404, 'order_not_found');
  return rows[0];
}

/**
 * Cancels an order and gives back its stock and slot place, all-or-nothing.
 * Only PLACED or PACKED orders can be cancelled.
 *
 * Double-cancel safety: the status UPDATE locks the order row. A second,
 * concurrent cancel waits, then re-checks "status IN ('PLACED','PACKED')",
 * finds CANCELLED, matches nothing, and gets 409. Stock is returned once.
 */
export function cancelOrder(orderId: number, userId?: number) {
  return withRetry(() =>
    withTransaction(async (db) => {
      const { rows } = await db.query(
        `UPDATE orders SET status = 'CANCELLED'
          WHERE id = $1 AND ($2::bigint IS NULL OR user_id = $2)
            AND status IN ('PLACED', 'PACKED')
          RETURNING id, store_id, slot_id, user_id`,
        [orderId, userId ?? null],
      );
      const order = rows[0];
      if (!order) {
        // Tell "doesn't exist (for you)" apart from "exists but can't be cancelled"
        const { rows: found } = await db.query(
          'SELECT status FROM orders WHERE id = $1 AND ($2::bigint IS NULL OR user_id = $2)',
          [orderId, userId ?? null],
        );
        if (!found[0]) throw new HttpError(404, 'order_not_found');
        throw new HttpError(409, 'cannot_cancel', { status: found[0].status });
      }

      // Same lock order as checkout: slot first, then products by id (no deadlocks)
      const slot = await db.query(
        'UPDATE delivery_slots SET booked = booked - 1 WHERE id = $1 RETURNING capacity - booked AS free',
        [order.slot_id],
      );
      const { rows: items } = await db.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id',
        [order.id],
      );
      const stockAfter: StockItem[] = [];
      for (const it of items) {
        const r = await db.query(
          `UPDATE store_inventory SET stock = stock + $3, updated_at = now()
            WHERE store_id = $1 AND product_id = $2 RETURNING stock`,
          [order.store_id, it.product_id, it.quantity],
        );
        if (r.rows[0]) stockAfter.push({ productId: Number(it.product_id), stock: r.rows[0].stock });
      }

      // Live updates, sent only if this transaction commits
      const storeId = Number(order.store_id);
      await notifyLive(db, { type: 'stock', storeId, items: stockAfter });
      await notifyLive(db, { type: 'slot', storeId, slotId: Number(order.slot_id), free: slot.rows[0].free });
      await notifyLive(db, {
        type: 'order', storeId, userId: Number(order.user_id), orderId: Number(order.id), status: 'CANCELLED',
      });
      return { id: String(order.id), status: 'CANCELLED' };
    }),
  );
}
