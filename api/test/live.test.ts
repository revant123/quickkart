import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { startLive, stopLive } from '../src/live.js';
import { resetDb, registerAndGetCookie, registerAdmin, seedShop, placeTestOrder } from './helpers.js';

// Live updates go browser <- SSE <- API <- PostgreSQL NOTIFY. These tests run a
// real HTTP server and read the event stream the way a browser's EventSource does.

const app = buildApp();
let server: Server;
let base: string;

type Received = { event: string; data: any };

/** Opens an SSE stream and collects events until close() is called. */
async function listen(path: string, cookie?: string) {
  const controller = new AbortController();
  const res = await fetch(base + path, {
    headers: cookie ? { cookie } : {},
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const events: Received[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = block.match(/^event: (.*)$/m)?.[1];
          const data = block.match(/^data: (.*)$/m)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  await new Promise((r) => setTimeout(r, 100)); // let the subscription register
  return { events, close: () => controller.abort() };
}

const settle = () => new Promise((r) => setTimeout(r, 300));

beforeAll(async () => {
  await startLive();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await stopLive();
  await pool.end();
});
beforeEach(async () => {
  await resetDb();
  await seedShop({ stock1: 7, stock2: 10, capacity: 20 });
});

describe('live updates (PostgreSQL NOTIFY -> Server-Sent Events)', () => {
  it('a purchase pushes the new stock and slot places to everyone watching the store', async () => {
    const shopper = await listen('/api/stores/1/live');
    const buyer = await registerAndGetCookie(app);

    await placeTestOrder(app, buyer, [{ productId: 1, quantity: 3 }]); // 7 -> 4: now "low"
    await settle();

    const stock = shopper.events.find((e) => e.event === 'stock');
    expect(stock?.data).toEqual([{ productId: 1, in_stock: true, low_stock: 4 }]);
    expect(stock?.data[0].stock).toBeUndefined(); // exact stock is never broadcast to shoppers
    expect(shopper.events.find((e) => e.event === 'slot')?.data).toEqual({ slotId: 1, free: 19 });
    expect(shopper.events.some((e) => e.event === 'order')).toBe(false); // orders are private
    shopper.close();
  });

  it('a FAILED checkout announces nothing (notify is delivered only on commit)', async () => {
    const shopper = await listen('/api/stores/1/live');
    const buyer = await registerAndGetCookie(app);
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', buyer)
      .set('Idempotency-Key', randomUUID())
      .send({
        storeId: 1, slotId: 1, address: '12 Sector 17, Chandigarh',
        items: [{ productId: 2, quantity: 1 }, { productId: 1, quantity: 8 }], // only 7 in stock: fails
      });
    expect(res.status).toBe(409);
    await settle();
    expect(shopper.events).toEqual([]);
    shopper.close();
  });

  it('only the right store hears about it', async () => {
    const otherStore = await listen('/api/stores/2/live');
    await placeTestOrder(app, await registerAndGetCookie(app), [{ productId: 1, quantity: 1 }]);
    await settle();
    expect(otherStore.events).toEqual([]);
    otherStore.close();
  });

  it('sold out and back in stock (cancel) both reach shoppers', async () => {
    const shopper = await listen('/api/stores/1/live');
    const buyer = await registerAndGetCookie(app);
    const id = await placeTestOrder(app, buyer, [{ productId: 1, quantity: 7 }]); // sells out
    await request(app).post(`/api/orders/${id}/cancel`).set('Cookie', buyer);
    await settle();

    const stockEvents = shopper.events.filter((e) => e.event === 'stock').map((e) => e.data[0]);
    expect(stockEvents).toEqual([
      { productId: 1, in_stock: false, low_stock: null },
      { productId: 1, in_stock: true, low_stock: null }, // back to 7
    ]);
    shopper.close();
  });

  it('a customer sees their own order status change live, and nobody else does', async () => {
    const asha = await registerAndGetCookie(app, 'asha@example.com');
    const ravi = await registerAndGetCookie(app, 'ravi@example.com');
    const admin = await registerAdmin(app);
    const id = await placeTestOrder(app, asha, [{ productId: 1, quantity: 1 }]);

    const ashaStream = await listen('/api/orders/live', asha);
    const raviStream = await listen('/api/orders/live', ravi);
    await request(app).patch(`/api/admin/orders/${id}/status`).set('Cookie', admin).send({ status: 'PACKED' });
    await settle();

    expect(ashaStream.events).toEqual([{ event: 'order', data: { orderId: Number(id), status: 'PACKED' } }]);
    expect(raviStream.events).toEqual([]);
    ashaStream.close();
    raviStream.close();
  });

  it('admins see exact stock and price changes; customers cannot open the admin stream', async () => {
    const admin = await registerAdmin(app);
    const adminStream = await listen('/api/admin/live', admin);
    await request(app)
      .patch('/api/admin/stores/1/inventory/2')
      .set('Cookie', admin)
      .send({ adjustStockBy: 5, pricePaise: 2500 });
    await settle();

    expect(adminStream.events[0].data).toMatchObject({
      type: 'stock', storeId: 1, items: [{ productId: 2, stock: 15, pricePaise: 2500, listed: true }],
    });
    adminStream.close();

    const customer = await registerAndGetCookie(app, 'c@example.com');
    expect((await request(app).get('/api/admin/live').set('Cookie', customer)).status).toBe(403);
  });
});

describe('catalog shows fresh stock even when the list itself comes from cache', () => {
  it('stock and price are read fresh; low stock shows a count', async () => {
    await pool.query('UPDATE store_inventory SET stock = 2 WHERE product_id = 1');
    const res = await request(app).get('/api/stores/1/products');
    const milk = res.body.items.find((p: { name: string }) => p.name === 'Milk');
    expect(milk).toMatchObject({ in_stock: true, low_stock: 2, price_paise: 5000 });
    expect(milk.stock).toBeUndefined();
  });
});
