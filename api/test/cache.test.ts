import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// These tests need a real Redis, so they only run when TEST_REDIS_URL is set:
//   docker run --rm -d -p 6380:6379 redis:8-alpine
//   TEST_REDIS_URL=redis://localhost:6380 npm test
// Without it they are skipped, and the rest of the suite runs with caching off.
const REDIS = process.env.TEST_REDIS_URL;

describe.skipIf(!REDIS)('Redis cache-aside for the catalog', () => {
  // Config is read when modules load, so set REDIS_URL first, then import the app
  let app: import('express').Express;
  let pool: import('pg').Pool;
  let redis: import('ioredis').Redis;
  let helpers: typeof import('./helpers.js');

  beforeAll(async () => {
    process.env.REDIS_URL = REDIS;
    app = (await import('../src/app.js')).buildApp();
    pool = (await import('../src/db.js')).pool;
    redis = (await import('../src/cache.js')).redis!;
    helpers = await import('./helpers.js');
    for (let i = 0; i < 50 && redis.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 50));
  });

  beforeEach(async () => {
    await redis.flushdb();
    await helpers.resetDb();
    await helpers.seedShop({ stock1: 1, stock2: 10 });
  });

  afterAll(async () => {
    redis.disconnect();
    await pool.end();
  });

  const shop = () => request(app).get('/api/stores/1/products');
  const milk = (res: request.Response) => res.body.items.find((p: { name: string }) => p.name === 'Milk');

  it('first request is a MISS, the same request again is a HIT with the same answer', async () => {
    const first = await shop();
    const second = await shop();
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body).toEqual(first.body);
  });

  it('different searches are cached separately', async () => {
    await shop();
    const search = await request(app).get('/api/stores/1/products?q=milk');
    expect(search.headers['x-cache']).toBe('MISS');
    expect(search.body.items).toHaveLength(1);
  });

  it('an admin price change shows immediately (version bump invalidates the store)', async () => {
    await shop(); // cache it
    const admin = await helpers.registerAdmin(app);
    await request(app)
      .patch('/api/admin/stores/1/inventory/1')
      .set('Cookie', admin)
      .send({ pricePaise: 9900 });

    const after = await shop();
    expect(after.headers['x-cache']).toBe('MISS');
    expect(milk(after).price_paise).toBe(9900);
  });

  it('the expensive search is cached, but stock is read fresh: after a sell-out the shop shows it at once', async () => {
    const customer = await helpers.registerAndGetCookie(app);
    expect(milk(await shop()).in_stock).toBe(true); // list now cached

    const buy = () =>
      request(app)
        .post('/api/orders')
        .set('Cookie', customer)
        .set('Idempotency-Key', `k-${Math.random()}`)
        .send({ storeId: 1, slotId: 1, address: '12 Sector 17, Chandigarh', items: [{ productId: 1, quantity: 1 }] });

    expect((await buy()).status).toBe(201); // buys the last one

    const after = await shop();
    expect(after.headers['x-cache']).toBe('HIT'); // the list came from Redis...
    expect(milk(after).in_stock).toBe(false); // ...but stock was read fresh from PostgreSQL

    const second = await buy();
    expect(second.status).toBe(409); // and checkout never trusts any cache anyway
    expect(second.body.error).toBe('out_of_stock');
  });

  it('if Redis goes down, the shop keeps working from the database', async () => {
    redis.disconnect();
    const res = await shop();
    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('OFF');
    expect(res.body.items.length).toBeGreaterThan(0);
    await redis.connect();
  });
});
