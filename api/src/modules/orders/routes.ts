import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { CheckoutBody, placeOrder } from './placeOrder.js';
import { listOrdersForUser, getOrder, cancelOrder } from './queries.js';

export const ordersRouter = Router();
ordersRouter.use(requireAuth); // every orders route needs a logged-in customer

const OrderId = z.coerce.number().int().positive();

// POST /api/orders
// Header: Idempotency-Key: <a fresh UUID per intended order, reused on retries>
// 201 created (or replayed) | 400 bad input / missing key | 401 not logged in
// 409 out_of_stock or slot_unavailable | 422 key reused with a different body
ordersRouter.post('/', async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 255) throw new HttpError(400, 'idempotency_key_required');
  const input = CheckoutBody.parse(req.body);

  const result = await placeOrder(req.user!.id, key, input);
  if (result.replay) res.set('Idempotent-Replayed', 'true');
  res.status(result.status).json(result.body);
});

// GET /api/orders -> my order history, newest first, each with its items
ordersRouter.get('/', async (req, res) => {
  res.json(await listOrdersForUser(req.user!.id));
});

// GET /api/orders/:id -> one of MY orders (404 if it isn't mine)
ordersRouter.get('/:id', async (req, res) => {
  res.json(await getOrder(OrderId.parse(req.params.id), req.user!.id));
});

// POST /api/orders/:id/cancel -> 200 | 404 not mine | 409 already packed/delivered/cancelled
ordersRouter.post('/:id/cancel', async (req, res) => {
  res.json(await cancelOrder(OrderId.parse(req.params.id), req.user!.id));
});
