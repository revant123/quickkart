import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { stockNewStores } from '../src/jobs.js';
import { registerAdmin, registerAndGetCookie, resetDb, seedShop } from './helpers.js';

const app = buildApp();

describe('pincodes all over India', () => {
  it('knows pincodes far beyond Chandigarh, with city and state', async () => {
    for (const [pin, state] of [['560034', 'Karnataka'], ['400058', 'Maharashtra'], ['208002', 'Uttar Pradesh'], ['700091', 'West Bengal']]) {
      const res = await request(app).get(`/api/pincodes/${pin}`);
      expect(res.status).toBe(200);
      expect(res.body.state).toBe(state);
      expect(typeof res.body.precise).toBe('boolean');
    }
  });

  it('has (almost) every pincode in the country', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM pincodes');
    expect(rows[0].n).toBeGreaterThan(19_000);
  });
});

describe('admin: opening stores', () => {
  let admin: string;
  beforeEach(async () => {
    await resetDb();
    await seedShop(); // 2 stores, 2 products
    admin = await registerAdmin(app);
  });

  it('opens a store at a pincode: located, stocked and bookable in one go', async () => {
    const res = await request(app).post('/api/admin/stores').set('Cookie', admin)
      .send({ name: 'QuickKart Koramangala', pincode: '560034' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ city: 'Bengaluru Urban', radius_km: 7, is_active: true });
    expect(res.body.lat).toBeCloseTo(12.93, 0);
    expect(res.body.slots).toBeGreaterThan(90); // every 30 min for 2 days
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM store_inventory WHERE store_id = $1', [res.body.id]);
    expect(rows[0].n).toBe(res.body.products);

    // Customers can now find it from a Bengaluru address
    const near = await request(app).get('/api/stores/nearest?lat=12.935&lng=77.624');
    expect(near.body.stores[0]).toMatchObject({ name: 'QuickKart Koramangala', delivers: true });
  });

  it('uses exact coordinates when given, and refuses duplicates and unknown pincodes', async () => {
    const exact = await request(app).post('/api/admin/stores').set('Cookie', admin)
      .send({ name: 'QuickKart Potheri', pincode: '603203', lat: 12.8231, lng: 80.0442, radiusKm: 5 });
    expect(exact.body).toMatchObject({ lat: 12.8231, lng: 80.0442, radius_km: 5 });
    const dup = await request(app).post('/api/admin/stores').set('Cookie', admin)
      .send({ name: 'quickkart potheri', pincode: '603203' });
    expect(dup.body.error).toBe('store_name_taken');
    const unknown = await request(app).post('/api/admin/stores').set('Cookie', admin)
      .send({ name: 'Nowhere', pincode: '100000' });
    expect(unknown.body.error).toBe('pincode_unknown');
  });

  it('closing a store hides it from customers; reopening brings it back', async () => {
    await request(app).patch('/api/admin/stores/2').set('Cookie', admin).send({ isActive: false }).expect(200);
    expect((await request(app).get('/api/stores')).body.map((s: any) => s.name)).toEqual(['Central']);
    await request(app).patch('/api/admin/stores/2').set('Cookie', admin).send({ isActive: true }).expect(200);
    expect((await request(app).get('/api/stores')).body).toHaveLength(2);
  });

  it('customers cannot open stores', async () => {
    const customer = await registerAndGetCookie(app, 'asha@example.com');
    expect((await request(app).post('/api/admin/stores').set('Cookie', customer)
      .send({ name: 'Mine', pincode: '560034' })).status).toBe(403);
  });

  it('the stock-new-stores job stocks stores that were added without products', async () => {
    // A realistic catalogue (stock_store picks ~60% of products at random)
    await pool.query(`INSERT INTO products (category_id, name, unit) SELECT 1, 'Milk ' || g, '1 l' FROM generate_series(1, 200) g`);
    await stockNewStores.run(); // seedShop's second store has no products yet either
    await pool.query(`INSERT INTO stores (name, city, pincode, lat, lng) VALUES ('Fresh', 'Pune', '411001', 18.52, 73.87)`);
    expect(await stockNewStores.run()).toBe('stocked 1 new stores');
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM store_inventory si JOIN stores s ON s.id = si.store_id WHERE s.name = 'Fresh')::int AS inv,
              (SELECT count(*) FROM delivery_slots ds JOIN stores s ON s.id = ds.store_id WHERE s.name = 'Fresh')::int AS slots`,
    );
    expect(rows[0].inv).toBeGreaterThan(80); // ~60% of 202
    expect(rows[0].slots).toBeGreaterThan(90);
    expect(await stockNewStores.run()).toBeUndefined(); // nothing left to do
  });
});
