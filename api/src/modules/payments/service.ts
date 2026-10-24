import { pool, withTransaction, type Queryable } from '../../db.js';
import { HttpError } from '../../errors.js';
import type { Job } from '../../jobs.js';
import { notifyLive } from '../../live.js';
import { notifyOrder } from '../../notifications/outbox.js';
import { cancelOrder } from '../orders/queries.js';
import { getGateway, signaturesMatch } from './gateway.js';

// ---------------------------------------------------------------------------
// Online payment, step by step:
//   1. POST /api/orders  {paymentMethod:'online'}  -> order PENDING_PAYMENT; stock
//      and slot are held (same safe checkout as cash orders).
//   2. POST /api/orders/:id/payment                 -> creates the gateway order.
//      Deliberately OUTSIDE the checkout transaction: a slow network call there
//      would keep the stock row locked and stall every other buyer.
//   3. The browser opens Razorpay; the customer pays.
//   4. POST /api/orders/:id/payment/verify          -> we check the signature and
//      mark the order PLACED. The webhook (Razorpay -> us) does the same thing, in
//      case the customer closed the tab before step 4.
//   5. Nobody paid within PAYMENT_EXPIRY_MINUTES?   -> job cancels, stock returns.
//   6. Money arrived for a cancelled order?         -> refund job pays it back.
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string; user_id: string; status: string; payment_method: string; payment_status: string;
  total_paise: number; payment_expires_at: Date | null; email: string; name: string; phone: string | null;
};

async function ownOnlineOrder(orderId: number, userId: number): Promise<OrderRow> {
  const { rows } = await pool.query(
    `SELECT o.id, o.user_id, o.status, o.payment_method, o.payment_status, o.total_paise,
            o.payment_expires_at, u.email, u.name, o.phone
       FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId],
  );
  if (!rows[0]) throw new HttpError(404, 'order_not_found');
  return rows[0];
}

/** Step 2: the details the browser needs to open the payment window. Safe to call repeatedly. */
export async function startPayment(orderId: number, userId: number) {
  const order = await ownOnlineOrder(orderId, userId);
  if (order.status !== 'PENDING_PAYMENT') {
    throw new HttpError(409, 'not_awaiting_payment', { status: order.status, paymentStatus: order.payment_status });
  }
  if (order.payment_expires_at && order.payment_expires_at.getTime() < Date.now()) {
    throw new HttpError(409, 'payment_expired');
  }
  const gateway = getGateway();

  const current = () =>
    pool.query('SELECT provider, provider_order_id, amount_paise, status FROM payments WHERE order_id = $1', [orderId])
      .then((r) => r.rows[0]);
  let payment = await current();
  // First attempt, or Razorpay keys were added since the last attempt: create a gateway order
  if (!payment || (payment.provider !== gateway.provider && payment.status === 'created')) {
    const gwOrder = await gateway.createOrder(order.total_paise, `qk-order-${order.id}`, {
      quickkart_order_id: String(order.id),
    });
    if (payment) {
      await pool.query(
        `UPDATE payments SET provider = $2, provider_order_id = $3, updated_at = now()
          WHERE order_id = $1 AND status = 'created'`,
        [order.id, gateway.provider, gwOrder.id],
      );
    } else {
      // Two clicks at once both create a gateway order; ON CONFLICT keeps the first
      // (the other is never paid, so it costs nothing).
      await pool.query(
        `INSERT INTO payments (order_id, provider, provider_order_id, amount_paise)
         VALUES ($1, $2, $3, $4) ON CONFLICT (order_id) DO NOTHING`,
        [order.id, gateway.provider, gwOrder.id, order.total_paise],
      );
    }
    payment = await current();
  }
  return {
    provider: payment.provider as 'razorpay' | 'fake',
    keyId: gateway.keyId,
    providerOrderId: payment.provider_order_id as string,
    amountPaise: payment.amount_paise as number,
    currency: 'INR',
    expiresAt: order.payment_expires_at?.toISOString() ?? null,
    prefill: { name: order.name, email: order.email, contact: order.phone ?? '' },
  };
}

/**
 * Records a successful payment and moves the order PENDING_PAYMENT -> PLACED.
 * Idempotent: the browser AND the webhook both report the same payment, often
 * within milliseconds; the payment row lock makes the second one a no-op.
 */
export async function recordPayment(db: Queryable, providerOrderId: string, providerPaymentId: string) {
  const { rows } = await db.query(
    'SELECT id, order_id, status FROM payments WHERE provider_order_id = $1 FOR UPDATE',
    [providerOrderId],
  );
  const payment = rows[0];
  if (!payment) return null; // not one of ours
  if (payment.status !== 'created') return { orderId: String(payment.order_id), duplicate: true };

  await db.query(
    `UPDATE payments SET status = 'paid', provider_payment_id = $2, updated_at = now() WHERE id = $1`,
    [payment.id, providerPaymentId],
  );
  const placed = await db.query(
    `UPDATE orders SET status = 'PLACED', payment_status = 'paid', payment_expires_at = NULL
      WHERE id = $1 AND status = 'PENDING_PAYMENT'
      RETURNING id, store_id, user_id`,
    [payment.order_id],
  );
  if (placed.rows[0]) {
    const o = placed.rows[0];
    await notifyOrder(db, o.id, 'order_placed');
    await notifyLive(db, {
      type: 'order', storeId: Number(o.store_id), userId: Number(o.user_id), orderId: Number(o.id), status: 'PLACED',
    });
    return { orderId: String(o.id), duplicate: false };
  }
  // The order was cancelled (payment window expired, or the customer cancelled)
  // before the money arrived. We have money for nothing: refund it.
  await db.query(
    `UPDATE orders SET payment_status = 'refund_pending' WHERE id = $1 AND status = 'CANCELLED'`,
    [payment.order_id],
  );
  return { orderId: String(payment.order_id), duplicate: false, refunding: true };
}

/** Step 4: the browser reports success. Never trust it: check the signature first. */
export async function verifyPayment(
  orderId: number,
  userId: number,
  body: { razorpay_payment_id: string; razorpay_signature: string },
) {
  await ownOnlineOrder(orderId, userId);
  const { rows } = await pool.query('SELECT provider_order_id FROM payments WHERE order_id = $1', [orderId]);
  if (!rows[0]) throw new HttpError(409, 'payment_not_started');
  // Sign OUR stored gateway order id, not the one the browser sent (per Razorpay's docs)
  const expected = getGateway().checkoutSignature(rows[0].provider_order_id, body.razorpay_payment_id);
  if (!signaturesMatch(expected, body.razorpay_signature)) throw new HttpError(400, 'invalid_payment_signature');

  await withTransaction((db) => recordPayment(db, rows[0].provider_order_id, body.razorpay_payment_id));
  const { rows: o } = await pool.query('SELECT id, status, payment_status FROM orders WHERE id = $1', [orderId]);
  return { orderId: String(o[0].id), status: o[0].status, paymentStatus: o[0].payment_status };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** Cancels online orders whose payment didn't arrive in time, returning their stock and slot. */
export const expireUnpaidOrders: Job = {
  name: 'expire-unpaid-orders',
  everyMs: 30_000,
  lockId: 7_320_003,
  async run() {
    const { rows } = await pool.query(
      `SELECT id FROM orders WHERE status = 'PENDING_PAYMENT' AND payment_expires_at < now()
        ORDER BY payment_expires_at LIMIT 100`,
    );
    let n = 0;
    for (const r of rows) {
      try {
        await cancelOrder(Number(r.id), { reason: 'payment_expired' });
        n++;
      } catch (e) {
        // 409: the payment landed a moment ago and the order is PLACED now. Fine.
        if (!(e instanceof HttpError && e.status === 409)) throw e;
      }
    }
    return n ? `cancelled ${n} unpaid orders` : undefined;
  },
};

/**
 * Pays back cancelled orders that had been paid online. Runs on one instance at a
 * time (advisory lock), so the same refund is never requested twice concurrently;
 * the gateway also refuses to refund more than was paid.
 */
export const processRefunds: Job = {
  name: 'process-refunds',
  everyMs: 20_000,
  lockId: 7_320_004,
  async run() {
    const { rows } = await pool.query(
      `SELECT o.id AS order_id, p.id AS payment_id, p.provider, p.provider_payment_id, p.amount_paise
         FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.payment_status = 'refund_pending' AND p.status = 'paid'
        ORDER BY o.id LIMIT 20`,
    );
    const gateway = getGateway();
    let n = 0;
    for (const r of rows) {
      if (r.provider !== gateway.provider) continue; // keys changed since; leave it for a human
      try {
        const refund = await gateway.refund(r.provider_payment_id, r.amount_paise);
        await withTransaction(async (db) => {
          await db.query(
            `UPDATE payments SET status = 'refunded', refund_id = $2, last_error = NULL, updated_at = now() WHERE id = $1`,
            [r.payment_id, refund.id],
          );
          await db.query(`UPDATE orders SET payment_status = 'refunded' WHERE id = $1`, [r.order_id]);
          await notifyOrder(db, r.order_id, 'payment_refunded', { refundPaise: r.amount_paise });
        });
        n++;
      } catch (e) {
        await pool.query('UPDATE payments SET last_error = $2, updated_at = now() WHERE id = $1', [
          r.payment_id, String((e as Error).message).slice(0, 500),
        ]);
      }
    }
    return n ? `refunded ${n} orders` : undefined;
  },
};
