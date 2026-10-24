import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import {
  resetDb, registerAndGetCookie, seedShop, stockOf, bookedIn, countRows,
} from './helpers.js';

const app = buildApp();
let cookie: string;

/** Sends one checkout request. A fresh idempotency key unless one is given. */
function checkout(body: object, key: string = randomUUID()) {
  return request(app)
    .post('/api/orders')
    .set('Cookie', cookie)
    .set('Idempotency-Key', key)
    .send(body);
}

const order = (items: { productId: number; quantity: number }[], slotId = 1) => ({
  storeId: 1, slotId, address: '12 Sector 17, Chandigarh', items,
});

/** Fires `n` identical requests at the SAME moment and waits for all of them. */
const concurrently = (n: number, fn: () => request.Test) =>
  Promise.all(Array.from({ length: n }, () => fn()));

afterAll(() => pool.end()); // close DB connections after ALL tests in this file

describe('checkout: the engineering challenges', () => {
  beforeEach(async () => {
    await resetDb();
    cookie = await registerAndGetCookie(app);
  });

  // ---- Challenge: last item purchased twice -------------------------------
  it('1. sells the last item exactly once under 10 concurrent checkouts', async () => {
    await seedShop({ stock1: 1 });
    const results = await concurrently(10, () => checkout(order([{ productId: 1, quantity: 1 }])));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((r) => r.body.error === 'out_of_stock')).toBe(true);
    expect(await stockOf(1)).toBe(0);
    expect(await countRows('orders')).toBe(1);
  });

  // ---- Challenge: too many delivery bookings ------------------------------
  it('2. never overbooks a slot: capacity 3, 10 concurrent checkouts', async () => {
    await seedShop({ stock1: 100, capacity: 3 });
    const results = await concurrently(10, () => checkout(order([{ productId: 1, quantity: 1 }])));

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    const rejected = results.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(7);
    expect(rejected.every((r) => r.body.error === 'slot_unavailable')).toBe(true);
    expect(await bookedIn(1)).toBe(3);
    expect(await stockOf(1)).toBe(97); // stock taken only for the 3 real orders
  });

  // ---- Challenge: duplicate checkout requests -----------------------------
  it('3. a retried request with the same key returns the same order, charged once', async () => {
    await seedShop({ stock1: 10 });
    const key = randomUUID();
    const first = await checkout(order([{ productId: 1, quantity: 2 }]), key);
    const retry = await checkout(order([{ productId: 1, quantity: 2 }]), key);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.orderId).toBe(first.body.orderId);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await stockOf(1)).toBe(8); // taken once, not twice
    expect(await countRows('orders')).toBe(1);
  });

  it('4. ten simultaneous requests with the same key create exactly one order', async () => {
    await seedShop({ stock1: 10 });
    const key = randomUUID();
    const results = await concurrently(10, () =>
      checkout(order([{ productId: 1, quantity: 1 }]), key),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.orderId)).size).toBe(1);
    expect(await countRows('orders')).toBe(1);
    expect(await stockOf(1)).toBe(9);
  });

  it('5. reusing a key with a DIFFERENT body is rejected with 422', async () => {
    await seedShop({ stock1: 10 });
    const key = randomUUID();
    expect((await checkout(order([{ productId: 1, quantity: 1 }]), key)).status).toBe(201);
    const misuse = await checkout(order([{ productId: 1, quantity: 5 }]), key);
    expect(misuse.status).toBe(422);
    expect(misuse.body.error).toBe('idempotency_key_reused');
  });

  // ---- All-or-nothing ------------------------------------------------------
  it('6. if any item is out of stock, NOTHING changes (atomicity)', async () => {
    await seedShop({ stock1: 0, stock2: 10 }); // milk sold out, curd available
    const res = await checkout(
      order([
        { productId: 2, quantity: 3 }, // curd: would succeed...
        { productId: 1, quantity: 1 }, // milk: fails -> everything rolls back
      ]),
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'out_of_stock', details: { productId: 1 } });
    expect(await stockOf(2)).toBe(10); // curd untouched
    expect(await bookedIn(1)).toBe(0); // slot not booked
    expect(await countRows('orders')).toBe(0);
    expect(await countRows('idempotency_keys')).toBe(0); // key released: client may retry
  });

  it('7. the total is computed from database prices, ignoring client-sent prices', async () => {
    await seedShop({ stock1: 10, stock2: 10 });
    const res = await checkout({
      ...order([
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
      ]),
      totalPaise: 1, // a tampered client would love this to work
      price: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.totalPaise).toBe(2 * 5000 + 1 * 2000);
  });
});

describe('checkout: validation and edge cases', () => {
  beforeEach(async () => {
    await resetDb();
    cookie = await registerAndGetCookie(app);
    await seedShop({ stock1: 10 });
  });

  it('requires login (401)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', randomUUID())
      .send(order([{ productId: 1, quantity: 1 }]));
    expect(res.status).toBe(401);
  });

  it('requires an Idempotency-Key header (400)', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', cookie)
      .send(order([{ productId: 1, quantity: 1 }]));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('idempotency_key_required');
  });

  it('rejects bad bodies (400)', async () => {
    expect((await checkout(order([]))).status).toBe(400); // empty cart
    expect((await checkout(order([{ productId: 1, quantity: 0 }]))).status).toBe(400);
    expect((await checkout({ ...order([{ productId: 1, quantity: 1 }]), address: 'x' })).status).toBe(400);
  });

  it('rejects a slot in the past (409)', async () => {
    const res = await checkout(order([{ productId: 1, quantity: 1 }], 2));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_unavailable');
  });

  it('rejects a slot that belongs to another store (409)', async () => {
    const res = await checkout({ ...order([{ productId: 1, quantity: 1 }]), storeId: 2 });
    expect(res.status).toBe(409);
  });

  it('merges duplicate lines for the same product', async () => {
    const res = await checkout(
      order([
        { productId: 1, quantity: 2 },
        { productId: 1, quantity: 3 },
      ]),
    );
    expect(res.status).toBe(201);
    expect(res.body.totalPaise).toBe(5 * 5000);
    expect(await stockOf(1)).toBe(5);
    expect(await countRows('order_items')).toBe(1);
  });

  it('keys are per user: two users can use the same key independently', async () => {
    const key = 'same-key-for-both';
    const a = await checkout(order([{ productId: 1, quantity: 1 }]), key);
    cookie = await registerAndGetCookie(app, 'ravi@example.com');
    const b = await checkout(order([{ productId: 1, quantity: 1 }]), key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.orderId).not.toBe(a.body.orderId);
  });
});
