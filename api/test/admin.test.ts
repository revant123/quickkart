import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import {
  resetDb, registerAndGetCookie, registerAdmin, seedShop, stockOf, bookedIn, placeTestOrder,
} from './helpers.js';

const app = buildApp();
let admin: string;
let customer: string;

afterAll(() => pool.end());

beforeEach(async () => {
  await resetDb();
  await seedShop({ stock1: 10, stock2: 3 });
  admin = await registerAdmin(app);
  customer = await registerAndGetCookie(app, 'asha@example.com');
});

describe('admin access control', () => {
  it('401 when logged out, 403 for a customer, 200 for an admin', async () => {
    const url = '/api/admin/orders';
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set('Cookie', customer)).status).toBe(403);
    expect((await request(app).get(url).set('Cookie', admin)).status).toBe(200);
  });

  it('a customer cannot change stock', async () => {
    const res = await request(app)
      .patch('/api/admin/stores/1/inventory/1')
      .set('Cookie', customer)
      .send({ adjustStockBy: 1000 });
    expect(res.status).toBe(403);
    expect(await stockOf(1)).toBe(10);
  });
});

describe('admin inventory', () => {
  const patch = (body: object, productId = 1) =>
    request(app).patch(`/api/admin/stores/1/inventory/${productId}`).set('Cookie', admin).send(body);

  it('lists inventory with exact stock, and filters low stock', async () => {
    const all = await request(app).get('/api/admin/stores/1/inventory').set('Cookie', admin);
    expect(all.status).toBe(200);
    expect(all.body.items.map((i: { stock: number }) => i.stock)).toEqual([10, 3]);

    const low = await request(app)
      .get('/api/admin/stores/1/inventory?lowStockBelow=5')
      .set('Cookie', admin);
    expect(low.body.items.map((i: { name: string }) => i.name)).toEqual(['Curd']);
  });

  it('adjusts stock RELATIVELY, so sales made meanwhile are not lost', async () => {
    // Admin's screen shows 10. Meanwhile a customer buys 2 (stock now 8).
    await placeTestOrder(app, customer, [{ productId: 1, quantity: 2 }]);
    // A delivery of 24 arrives: admin adds +24 (not "set to 34")
    const res = await patch({ adjustStockBy: 24 });
    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(32); // 10 - 2 + 24: the sale was not erased
  });

  it('refuses to take stock below zero (409)', async () => {
    const res = await patch({ adjustStockBy: -11 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('stock_would_go_negative');
    expect(await stockOf(1)).toBe(10);
  });

  it('changes price; new orders use it', async () => {
    expect((await patch({ pricePaise: 6000 })).body.price_paise).toBe(6000);
    const id = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    const order = await request(app).get(`/api/orders/${id}`).set('Cookie', customer);
    expect(order.body.total_paise).toBe(6000);
  });

  it('unlisting hides a product from the shop', async () => {
    await patch({ isListed: false });
    const shop = await request(app).get('/api/stores/1/products');
    expect(shop.body.items.map((p: { name: string }) => p.name)).toEqual(['Curd']);
  });

  it('validates input', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ pricePaise: -5 })).status).toBe(400);
    expect((await patch({ adjustStockBy: 1 }, 999)).status).toBe(404);
  });
});

describe('admin delivery slots', () => {
  it('creates a slot; a duplicate start time is 409; past is 400', async () => {
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const create = () =>
      request(app)
        .post('/api/admin/stores/1/slots')
        .set('Cookie', admin)
        .send({ startsAt, capacity: 8 });

    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ capacity: 8, booked: 0 });
    expect(new Date(res.body.ends_at).getTime() - new Date(res.body.starts_at).getTime()).toBe(
      30 * 60 * 1000,
    );
    expect((await create()).status).toBe(409);

    const past = await request(app)
      .post('/api/admin/stores/1/slots')
      .set('Cookie', admin)
      .send({ startsAt: '2020-01-01T10:00:00Z', capacity: 5 });
    expect(past.status).toBe(400);
  });
});

describe('admin orders and status changes', () => {
  const setStatus = (id: string, status: string) =>
    request(app).patch(`/api/admin/orders/${id}/status`).set('Cookie', admin).send({ status });

  it('lists all orders, filterable by status', async () => {
    const a = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    await setStatus(a, 'PACKED');

    const all = await request(app).get('/api/admin/orders').set('Cookie', admin);
    expect(all.body).toHaveLength(2);
    expect(all.body[0]).toMatchObject({ customer_email: 'asha@example.com', item_count: 1 });

    const packed = await request(app).get('/api/admin/orders?status=PACKED').set('Cookie', admin);
    expect(packed.body.map((o: { id: string }) => o.id)).toEqual([a]);
  });

  it('follows the state machine: PLACED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED', async () => {
    const id = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    expect((await setStatus(id, 'PACKED')).body.status).toBe('PACKED');
    expect((await setStatus(id, 'OUT_FOR_DELIVERY')).body.status).toBe('OUT_FOR_DELIVERY');
    expect((await setStatus(id, 'DELIVERED')).body.status).toBe('DELIVERED');
  });

  it('rejects illegal transitions with 409', async () => {
    const id = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    const skip = await setStatus(id, 'DELIVERED'); // PLACED -> DELIVERED skips steps
    expect(skip.status).toBe(409);
    expect(skip.body).toMatchObject({
      error: 'illegal_transition', details: { from: 'PLACED', to: 'DELIVERED' },
    });
    expect((await setStatus('999999', 'PACKED')).status).toBe(404);
  });

  it('admin cancel of a PACKED order returns stock and slot', async () => {
    const id = await placeTestOrder(app, customer, [{ productId: 1, quantity: 4 }]);
    await setStatus(id, 'PACKED');
    expect((await setStatus(id, 'CANCELLED')).body.status).toBe('CANCELLED');
    expect(await stockOf(1)).toBe(10);
    expect(await bookedIn(1)).toBe(0);
  });
});

describe('admin reports', () => {
  it('sales by store and day exclude cancelled orders', async () => {
    await placeTestOrder(app, customer, [{ productId: 1, quantity: 2 }]); // 10000
    await placeTestOrder(app, customer, [{ productId: 2, quantity: 1 }]); // 2000
    const cancelled = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    await request(app).post(`/api/orders/${cancelled}/cancel`).set('Cookie', customer);

    const res = await request(app).get('/api/admin/reports/sales').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ store: 'Central', orders: 2, revenue_paise: 12000 });
  });

  it('top products by units sold', async () => {
    await placeTestOrder(app, customer, [{ productId: 2, quantity: 1 }]);
    await placeTestOrder(app, customer, [{ productId: 1, quantity: 3 }]);
    const res = await request(app)
      .get('/api/admin/reports/top-products?storeId=1')
      .set('Cookie', admin);
    expect(res.body.map((r: { name: string; units_sold: number }) => [r.name, r.units_sold])).toEqual([
      ['Milk', 3],
      ['Curd', 1],
    ]);
  });

  it('slot utilisation for the next 24 hours', async () => {
    await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    const res = await request(app).get('/api/admin/reports/slots?storeId=1').set('Cookie', admin);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ capacity: 100, booked: 1, utilisation_pct: 1 });
  });
});
