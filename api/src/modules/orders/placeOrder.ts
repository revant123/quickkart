import { createHash } from 'node:crypto';
import { z } from 'zod';
import { withTransaction, withRetry } from '../../db.js';
import { HttpError } from '../../errors.js';
import { notifyLive, type StockItem } from '../../live.js';
import { config } from '../../config.js';
import { assertDelivers } from '../location/geo.js';
import { notifyOrder } from '../../notifications/outbox.js';

// ---------------------------------------------------------------------------
// The checkout. Solves three engineering challenges in ONE transaction:
//   1. Last item purchased twice  -> atomic conditional stock UPDATE
//   2. Too many delivery bookings -> atomic conditional slot UPDATE
//   3. Duplicate checkout requests -> idempotency key, saved with the order
// Either everything below happens, or (on any error) nothing does.
// ---------------------------------------------------------------------------

export const CheckoutBody = z.object({
  storeId: z.number().int().positive(),
  slotId: z.number().int().positive(),
  // A saved address (checked against the store's delivery area)...
  addressId: z.number().int().positive().optional(),
  // ...or, for API clients and the load tests, free text with no area check
  address: z.string().trim().min(5).max(300).optional(),
  // cod: pay the rider in cash · online: pay now (order waits in PENDING_PAYMENT)
  paymentMethod: z.enum(['cod', 'online']).default('cod'),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(50),
  // Any other field the client sends (e.g. a fake "price") is stripped by Zod.
}).refine((b) => b.addressId !== undefined || b.address !== undefined, {
  message: 'addressId or address is required',
  path: ['addressId'],
});
export type CheckoutInput = z.infer<typeof CheckoutBody>;

export type CheckoutResult = {
  status: number;
  body: {
    orderId: string;
    status: string;
    totalPaise: number;
    paymentMethod: 'cod' | 'online';
    paymentExpiresAt: string | null;
  };
  replay: boolean;
};

/**
 * Merges duplicate lines ("milk x1" + "milk x2" -> "milk x3") and sorts by
 * productId. Sorting gives every checkout the SAME lock order, which prevents
 * deadlocks: two orders can never each hold a row the other one is waiting for.
 */
function normaliseItems(items: CheckoutInput['items']) {
  const merged = new Map<number, number>();
  for (const it of items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.quantity);
  return [...merged]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId - b.productId);
}

export function placeOrder(userId: number, key: string, rawInput: z.input<typeof CheckoutBody>) {
  const input: CheckoutInput = CheckoutBody.parse(rawInput); // applies defaults (cash on delivery)
  // Fingerprint of the request, to detect the same key reused with a different body
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');

  return withRetry(() =>
    withTransaction(async (db): Promise<CheckoutResult> => {
      // ---- 1. Claim the idempotency key ---------------------------------
      // If another request with the same key is running right now, this INSERT
      // WAITS for it to finish (unique index). Then it sees the conflict and
      // inserts nothing, and we return the saved response instead of buying again.
      const claim = await db.query(
        `INSERT INTO idempotency_keys (user_id, key, request_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING`,
        [userId, key, requestHash],
      );
      if (claim.rowCount === 0) {
        const { rows } = await db.query(
          `SELECT request_hash, response_code, response_body
             FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
          [userId, key],
        );
        const saved = rows[0];
        if (saved.request_hash !== requestHash) {
          throw new HttpError(422, 'idempotency_key_reused');
        }
        return { status: saved.response_code, body: saved.response_body, replay: true };
      }

      // ---- 1b. Where is it going? A saved address must be the customer's own
      // and inside the store's delivery area.
      let delivery = { text: input.address ?? '', phone: null as string | null, lat: null as number | null, lng: null as number | null };
      if (input.addressId !== undefined) {
        const { rows: a } = await db.query(
          'SELECT line1, line2, city, pincode, phone, lat, lng FROM addresses WHERE id = $1 AND user_id = $2',
          [input.addressId, userId],
        );
        if (!a[0]) throw new HttpError(404, 'address_not_found');
        await assertDelivers(db, input.storeId, a[0]);
        delivery = {
          // A COPY of the address: editing it later never changes this order
          text: [a[0].line1, a[0].line2, `${a[0].city} ${a[0].pincode}`].filter(Boolean).join(', '),
          phone: a[0].phone,
          lat: a[0].lat,
          lng: a[0].lng,
        };
      }

      // ---- 2. Reserve a delivery slot (capacity-safe) --------------------
      // Check and write in ONE statement. The UPDATE locks the slot row; a
      // concurrent checkout waits, then PostgreSQL re-checks "booked < capacity"
      // against the NEW value. So a full slot can never be overbooked.
      // (The slot is always locked BEFORE any inventory row: fixed lock order.)
      const slot = await db.query(
        `UPDATE delivery_slots SET booked = booked + 1
          WHERE id = $1 AND store_id = $2 AND booked < capacity AND starts_at > now()
          RETURNING id, capacity - booked AS free`,
        [input.slotId, input.storeId],
      );
      if (slot.rowCount === 0) throw new HttpError(409, 'slot_unavailable');

      // ---- 3. Take stock atomically, item by item, in productId order ----
      // Same pattern: "stock >= qty" is checked INSIDE the UPDATE, so there is
      // no gap between checking and writing for another request to slip into.
      // The price comes from the database, never from the client.
      let total = 0;
      const lines: { productId: number; quantity: number; unitPrice: number }[] = [];
      const stockAfter: StockItem[] = [];
      for (const it of normaliseItems(input.items)) {
        const r = await db.query(
          `UPDATE store_inventory
              SET stock = stock - $3, updated_at = now()
            WHERE store_id = $1 AND product_id = $2 AND is_listed AND stock >= $3
            RETURNING price_paise, stock`,
          [input.storeId, it.productId, it.quantity],
        );
        if (r.rowCount === 0) {
          // Throwing rolls back EVERYTHING: the slot booking, stock already
          // taken for earlier items, and the idempotency key.
          throw new HttpError(409, 'out_of_stock', { productId: it.productId });
        }
        const unitPrice: number = r.rows[0].price_paise;
        total += unitPrice * it.quantity;
        lines.push({ ...it, unitPrice });
        stockAfter.push({ productId: it.productId, stock: r.rows[0].stock });
      }

      // ---- 4. Create the order and its lines -----------------------------
      // Online orders hold their stock and slot place for PAYMENT_EXPIRY_MINUTES.
      // If payment doesn't arrive by then, a job cancels them and releases both.
      const online = input.paymentMethod === 'online';
      const { rows: orderRows } = await db.query(
        `INSERT INTO orders (user_id, store_id, slot_id, total_paise, address, address_id, phone,
                             delivery_lat, delivery_lng, payment_method, status, payment_status,
                             payment_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 CASE WHEN $10 = 'online' THEN now() + make_interval(mins => $13) END)
         RETURNING id, status, total_paise, payment_method, payment_expires_at`,
        [userId, input.storeId, input.slotId, total, delivery.text, input.addressId ?? null, delivery.phone,
          delivery.lat, delivery.lng, input.paymentMethod,
          online ? 'PENDING_PAYMENT' : 'PLACED', online ? 'pending' : 'unpaid', config.PAYMENT_EXPIRY_MINUTES],
      );
      const order = orderRows[0];
      for (const l of lines) {
        await db.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
           VALUES ($1, $2, $3, $4)`,
          [order.id, l.productId, l.quantity, l.unitPrice],
        );
      }

      // ---- Live updates: queued now, delivered only if this transaction commits
      await notifyLive(db, { type: 'stock', storeId: input.storeId, items: stockAfter });
      await notifyLive(db, { type: 'slot', storeId: input.storeId, slotId: input.slotId, free: slot.rows[0].free });
      await notifyLive(db, {
        type: 'order', storeId: input.storeId, userId, orderId: Number(order.id), status: order.status,
      });

      // Confirmation email + SMS, saved in the outbox with the order (sent after commit).
      // Online orders get theirs when the payment arrives.
      if (!online) await notifyOrder(db, order.id, 'order_placed');

      // ---- 5. Save the response with the key (commits with the order) ---
      const body = {
        orderId: String(order.id),
        status: order.status as string,
        totalPaise: order.total_paise as number,
        paymentMethod: order.payment_method as 'cod' | 'online',
        paymentExpiresAt: order.payment_expires_at ? new Date(order.payment_expires_at).toISOString() : null,
      };
      await db.query(
        `UPDATE idempotency_keys SET response_code = 201, response_body = $3
          WHERE user_id = $1 AND key = $2`,
        [userId, key, body],
      );
      return { status: 201, body, replay: false };
    }),
  );
}
