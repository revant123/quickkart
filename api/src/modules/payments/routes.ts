import express, { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { fakeCheckoutSuccess, getGateway, hmacHex, signaturesMatch } from './gateway.js';
import { recordPayment } from './service.js';

export const paymentsRouter = Router();

// GET /api/payments/config -> which gateway the browser should open
paymentsRouter.get('/config', (_req, res) => {
  const g = getGateway();
  res.json({ provider: g.provider, keyId: g.keyId });
});

// POST /api/payments/fake/pay { providerOrderId, outcome } -> what Razorpay's window would
// return. Only exists while the built-in test gateway is active.
const FakePay = z.object({ providerOrderId: z.string().min(1).max(100), outcome: z.enum(['success', 'failure']) });
paymentsRouter.post('/fake/pay', requireAuth, async (req, res) => {
  if (getGateway().provider !== 'fake') throw new HttpError(404, 'not_found');
  const body = FakePay.parse(req.body);
  const { rows } = await pool.query(
    `SELECT 1 FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.provider_order_id = $1 AND o.user_id = $2`,
    [body.providerOrderId, req.user!.id],
  );
  if (!rows[0]) throw new HttpError(404, 'payment_not_found');
  if (body.outcome === 'failure') throw new HttpError(402, 'payment_declined');
  res.json(fakeCheckoutSuccess(body.providerOrderId));
});

// ---------------------------------------------------------------------------
// POST /api/payments/razorpay/webhook   (Razorpay's servers -> us)
//
// Mounted BEFORE express.json() in app.ts: the signature is over the exact raw
// bytes, and parsing then re-serialising JSON would change them.
// Always answers 2xx for events we've understood, so Razorpay stops retrying.
// ---------------------------------------------------------------------------
export const razorpayWebhook = Router();
razorpayWebhook.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const secret = getGateway().webhookSecret;
  if (!secret) throw new HttpError(404, 'webhooks_not_configured');
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !signaturesMatch(hmacHex(secret, raw), req.get('X-Razorpay-Signature'))) {
    throw new HttpError(400, 'invalid_webhook_signature');
  }
  const event = JSON.parse(raw.toString('utf8'));
  const eventId = req.get('x-razorpay-event-id') ?? `${event.event}:${event.payload?.payment?.entity?.id}`;
  const entity = event.payload?.payment?.entity;

  const result = await withTransaction(async (db) => {
    // Same event delivered twice? The primary key makes the second insert do nothing.
    // Recorded in the SAME transaction as its effect: if handling fails, the event
    // isn't marked done, and Razorpay's retry gets a second chance.
    const fresh = await db.query(
      'INSERT INTO payment_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [eventId, event.event],
    );
    if (fresh.rowCount === 0) return 'duplicate';
    if ((event.event === 'payment.captured' || event.event === 'order.paid') && entity?.order_id) {
      const r = await recordPayment(db, entity.order_id, entity.id);
      return r ? 'recorded' : 'unknown_order';
    }
    if (event.event === 'payment.failed' && entity?.order_id) {
      await db.query(
        `UPDATE payments SET last_error = $2, updated_at = now() WHERE provider_order_id = $1 AND status = 'created'`,
        [entity.order_id, String(entity.error_description ?? 'payment failed').slice(0, 500)],
      );
      return 'failure_noted';
    }
    return 'ignored';
  });
  res.json({ ok: true, result });
});
