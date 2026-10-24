import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { CheckoutBody, placeOrder } from './placeOrder.js';
import { listOrdersForUser, getOrder, cancelOrder } from './queries.js';
import { openStream } from '../../live.js';

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

  // POST /api/orders/:id/cancel -> 200 | 404 not mine | 409 already packed/delivered/cancelled
  router.post('/:id/cancel', async (req, res) => {
    res.json(await cancelOrder(OrderId.parse(req.params.id), req.user!.id));
  });

  return router;
}
