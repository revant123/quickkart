import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import {
  resetDb, registerAndGetCookie, seedShop, stockOf, bookedIn, placeTestOrder,
} from './helpers.js';

const app = buildApp();
let asha: string; // customer 1
let ravi: string; // customer 2

afterAll(() => pool.end());

beforeEach(async () => {
  await resetDb();
  await seedShop({ stock1: 10, stock2: 10 });
  asha = await registerAndGetCookie(app, 'asha@example.com');
  ravi = await registerAndGetCookie(app, 'ravi@example.com');
});

describe('order history', () => {
  it('lists only MY orders, newest first, with items', async () => {
    const first = await placeTestOrder(app, asha, [{ productId: 1, quantity: 2 }]);
    const second = await placeTestOrder(app, asha, [
      { productId: 2, quantity: 1 },
      { productId: 1, quantity: 1 },
    ]);
    await placeTestOrder(app, ravi, [{ productId: 1, quantity: 1 }]);

    const res = await request(app).get('/api/orders').set('Cookie', asha);
    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([second, first]);
    expect(res.body[0].items).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ status: 'PLACED', store_name: 'Central', total_paise: 7000 });
    expect(res.body[0].items[0]).toMatchObject({ name: 'Curd', quantity: 1, unitPricePaise: 2000 });
  });

  it('requires login', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
  });

  it("shows my order, but 404 for someone else's (not 403: don't leak that it exists)", async () => {
    const id = await placeTestOrder(app, asha, [{ productId: 1, quantity: 1 }]);
    expect((await request(app).get(`/api/orders/${id}`).set('Cookie', asha)).status).toBe(200);
    expect((await request(app).get(`/api/orders/${id}`).set('Cookie', ravi)).status).toBe(404);
    expect((await request(app).get('/api/orders/999999').set('Cookie', asha)).status).toBe(404);
  });

  it('keeps the price paid even if the store changes the price later', async () => {
    const id = await placeTestOrder(app, asha, [{ productId: 1, quantity: 1 }]);
    await pool.query('UPDATE store_inventory SET price_paise = 9999 WHERE product_id = 1');
    const res = await request(app).get(`/api/orders/${id}`).set('Cookie', asha);
    expect(res.body.items[0].unitPricePaise).toBe(5000);
    expect(res.body.total_paise).toBe(5000);
  });
});

describe('cancelling an order', () => {
  it('gives back the stock and the slot place', async () => {
    const id = await placeTestOrder(app, asha, [
      { productId: 1, quantity: 3 },
      { productId: 2, quantity: 2 },
    ]);
    expect(await stockOf(1)).toBe(7);
    expect(await bookedIn(1)).toBe(1);

    const res = await request(app).post(`/api/orders/${id}/cancel`).set('Cookie', asha);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(await stockOf(1)).toBe(10);
    expect(await stockOf(2)).toBe(10);
    expect(await bookedIn(1)).toBe(0);
  });

  it('10 simultaneous cancels return the stock exactly once', async () => {
    const id = await placeTestOrder(app, asha, [{ productId: 1, quantity: 4 }]);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post(`/api/orders/${id}/cancel`).set('Cookie', asha),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await stockOf(1)).toBe(10); // not 46
    expect(await bookedIn(1)).toBe(0); // not -9
  });

  it("can't cancel someone else's order (404)", async () => {
    const id = await placeTestOrder(app, asha, [{ productId: 1, quantity: 1 }]);
    expect((await request(app).post(`/api/orders/${id}/cancel`).set('Cookie', ravi)).status).toBe(404);
    expect(await stockOf(1)).toBe(9);
  });

  it("can't cancel once out for delivery (409)", async () => {
    const id = await placeTestOrder(app, asha, [{ productId: 1, quantity: 1 }]);
    await pool.query(`UPDATE orders SET status = 'OUT_FOR_DELIVERY' WHERE id = $1`, [id]);
    const res = await request(app).post(`/api/orders/${id}/cancel`).set('Cookie', asha);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'cannot_cancel', details: { status: 'OUT_FOR_DELIVERY' } });
  });
});
