import { Router } from 'express';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { CheckoutBody, placeOrder } from './placeOrder.js';

export const ordersRouter = Router();

// POST /api/orders
// Header: Idempotency-Key: <a fresh UUID per intended order, reused on retries>
// 201 created (or replayed) | 400 bad input / missing key | 401 not logged in
// 409 out_of_stock or slot_unavailable | 422 key reused with a different body
ordersRouter.post('/', requireAuth, async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || key.length > 255) throw new HttpError(400, 'idempotency_key_required');
  const input = CheckoutBody.parse(req.body);

  const result = await placeOrder(req.user!.id, key, input);
  if (result.replay) res.set('Idempotent-Replayed', 'true');
  res.status(result.status).json(result.body);
});

// Day 4: GET /api/orders, GET /api/orders/:id, POST /api/orders/:id/cancel
