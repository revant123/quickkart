import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { CheckoutBody, placeOrder } from './placeOrder.js';
import { listOrdersForUser, getOrder, cancelOrder } from './queries.js';
import { openStream } from '../../live.js';
import { config } from '../../config.js';
import { startPayment, verifyPayment } from '../payments/service.js';

const OrderId = z.coerce.number().int().positive();

export function createOrdersRouter(checkoutLimiter: RequestHandler) {
  const router = Router();
  router.use(requireAuth); // every orders route needs a logged-in customer

  // POST /api/orders
  // Header: Idempotency-Key: <a fresh UUID per intended order, reused on retries>
  // 201 created (or replayed) | 400 bad input / missing key | 401 not logged in
  // 409 out_of_stock or slot_unavailable | 422 key reused with a different body | 429 too many
  router.post('/', checkoutLimiter, async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 255) throw new HttpError(400, 'idempotency_key_required');
    const input = CheckoutBody.parse(req.body);
    if (config.REQUIRE_VERIFIED_EMAIL && !req.user!.emailVerified) throw new HttpError(403, 'email_not_verified');

    const result = await placeOrder(req.user!.id, key, input);
    if (result.replay) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // GET /api/orders -> my order history, newest first, each with its items
  router.get('/', async (req, res) => {
    res.json(await listOrdersForUser(req.user!.id));
  });

  // GET /api/orders/live -> Server-Sent Events: status changes of MY orders only
  // (registered before /:id so "live" isn't read as an order id)
  router.get('/live', (req, res) => {
    const me = req.user!.id;
    openStream(req, res, (e) =>
      e.type === 'order' && e.userId === me
        ? { event: 'order', data: { orderId: e.orderId, status: e.status } }
        : null,
    );
  });

  // GET /api/orders/:id -> one of MY orders (404 if it isn't mine)
  router.get('/:id', async (req, res) => {
    res.json(await getOrder(OrderId.parse(req.params.id), req.user!.id));
  });

  // POST /api/orders/:id/payment -> details for opening the payment window
  // 200 | 404 | 409 not_awaiting_payment / payment_expired | 502 gateway down
  router.post('/:id/payment', checkoutLimiter, async (req, res) => {
    res.json(await startPayment(OrderId.parse(req.params.id), req.user!.id));
  });

  // POST /api/orders/:id/payment/verify { razorpay_payment_id, razorpay_signature }
  // 200 order now PLACED | 400 invalid_payment_signature | 404 | 409 payment_not_started
  const VerifyBody = z.object({
    razorpay_order_id: z.string().max(100).optional(),
    razorpay_payment_id: z.string().min(1).max(100),
    razorpay_signature: z.string().min(1).max(200),
  });
  router.post('/:id/payment/verify', async (req, res) => {
    res.json(await verifyPayment(OrderId.parse(req.params.id), req.user!.id, VerifyBody.parse(req.body)));
  });

  // POST /api/orders/:id/cancel -> 200 | 404 not mine | 409 already packed/delivered/cancelled
  router.post('/:id/cancel', async (req, res) => {
    res.json(await cancelOrder(OrderId.parse(req.params.id), { userId: req.user!.id, reason: 'customer' }));
  });

  return router;
}
