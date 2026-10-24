import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { addAddress, locateStores, registerAndGetCookie, resetDb, seedShop } from './helpers.js';

const app = buildApp();

describe('nearest store', () => {
  beforeEach(async () => {
    await resetDb();
    await seedShop();
    await locateStores();
  });

  it('finds stores by pincode, nearest first, with distance and whether they deliver', async () => {
    const res = await request(app).get('/api/stores/nearest?pincode=160012'); // PGI, near North
    expect(res.status).toBe(200);
    expect(res.body.point).toMatchObject({ pincode: '160012', city: 'Chandigarh' });
    expect(res.body.stores.map((s: any) => s.name)).toEqual(['North', 'Central']);
    expect(res.body.stores[0].distance_km).toBeLessThan(2);
    expect(res.body.stores.every((s: any) => s.delivers)).toBe(true);
  });

  it('finds stores from GPS coordinates', async () => {
    const res = await request(app).get('/api/stores/nearest?lat=30.7400&lng=76.7830');
    expect(res.body.stores[0].name).toBe('Central');
  });

  it('marks stores that are too far away as not delivering', async () => {
    const res = await request(app).get('/api/stores/nearest?pincode=140603'); // Zirakpur, ~11 km
    expect(res.body.stores.every((s: any) => !s.delivers)).toBe(true);
  });

  it('404 for a pincode it does not know, 400 for nonsense', async () => {
    expect((await request(app).get('/api/stores/nearest?pincode=999999')).body.error).toBe('pincode_unknown');
    expect((await request(app).get('/api/stores/nearest?pincode=12')).status).toBe(400);
    expect((await request(app).get('/api/stores/nearest?lat=200&lng=1')).status).toBe(400);
  });
});

describe('saved addresses', () => {
  let cookie: string;
  beforeEach(async () => {
    await resetDb();
    await seedShop();
    await locateStores();
    cookie = await registerAndGetCookie(app);
  });

  it('first address becomes the default and gets the pincode centre as its location', async () => {
    const res = await request(app).post('/api/me/addresses').set('Cookie', cookie).send({
      line1: '12, Sector 17-C', city: 'Chandigarh', pincode: '160017', phone: '+91 98765-43210',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ label: 'Home', is_default: true, phone: '9876543210', lat: 30.741, lng: 76.782 });
  });

  it('keeps exactly one default address', async () => {
    const a = await addAddress(app, cookie);
    const b = await addAddress(app, cookie, { label: 'Work', isDefault: true });
    let list = (await request(app).get('/api/me/addresses').set('Cookie', cookie)).body;
    expect(list.map((x: any) => [Number(x.id), x.is_default])).toEqual([[b, true], [a, false]]);

    await request(app).patch(`/api/me/addresses/${a}`).set('Cookie', cookie).send({ isDefault: true }).expect(200);
    list = (await request(app).get('/api/me/addresses').set('Cookie', cookie)).body;
    expect(list.filter((x: any) => x.is_default).map((x: any) => Number(x.id))).toEqual([a]);

    // Deleting the default promotes another one
    await request(app).delete(`/api/me/addresses/${a}`).set('Cookie', cookie).expect(204);
    list = (await request(app).get('/api/me/addresses').set('Cookie', cookie)).body;
    expect(list).toHaveLength(1);
    expect(list[0].is_default).toBe(true);
  });

  it('rejects bad phone numbers and unknown pincodes', async () => {
    const bad = await request(app).post('/api/me/addresses').set('Cookie', cookie)
      .send({ line1: '12 Main Road', city: 'Chandigarh', pincode: '160017', phone: '12345' });
    expect(bad.status).toBe(400);
    const unknown = await request(app).post('/api/me/addresses').set('Cookie', cookie)
      .send({ line1: '12 Main Road', city: 'Chandigarh', pincode: '999999', phone: '9876543210' });
    expect(unknown.body.error).toBe('pincode_unknown');
  });

  it("can't see or change someone else's address (404)", async () => {
    const mine = await addAddress(app, cookie);
    const other = await registerAndGetCookie(app, 'ravi@example.com');
    expect((await request(app).get('/api/me/addresses').set('Cookie', other)).body).toEqual([]);
    await request(app).patch(`/api/me/addresses/${mine}`).set('Cookie', other).send({ label: 'x' }).expect(404);
    await request(app).delete(`/api/me/addresses/${mine}`).set('Cookie', other).expect(404);
  });

  it('allows at most 10 addresses, even when added all at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 14 }, (_, i) =>
        request(app).post('/api/me/addresses').set('Cookie', cookie)
          .send({ line1: `House ${i}`, city: 'Chandigarh', pincode: '160017', phone: '9876543210' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.body.error === 'too_many_addresses')).toHaveLength(4);
  });
});

describe('checkout with a saved address', () => {
  let cookie: string;
  beforeEach(async () => {
    await resetDb();
    await seedShop({ stock1: 5 });
    await locateStores();
    cookie = await registerAndGetCookie(app);
  });

  const order = (body: Record<string, unknown>) =>
    request(app).post('/api/orders').set('Cookie', cookie).set('Idempotency-Key', `k-${Math.random()}`)
      .send({ storeId: 1, slotId: 1, items: [{ productId: 1, quantity: 1 }], ...body });

  it('copies the address and phone onto the order', async () => {
    const addressId = await addAddress(app, cookie, { line2: 'Near the fountain' });
    const res = await order({ addressId });
    expect(res.status).toBe(201);
    const { rows } = await pool.query('SELECT address, phone, delivery_lat FROM orders');
    expect(rows[0]).toMatchObject({
      address: '12, Sector 17-C, Near the fountain, Chandigarh 160017', phone: '9876543210', delivery_lat: 30.741,
    });
    // Editing the address later doesn't change the order
    await request(app).patch(`/api/me/addresses/${addressId}`).set('Cookie', cookie).send({ line1: 'Moved' });
    expect((await pool.query('SELECT address FROM orders')).rows[0].address).toMatch(/^12, Sector 17-C/);
  });

  it('refuses an address outside the store delivery area, and changes nothing', async () => {
    const far = await addAddress(app, cookie, { pincode: '140603', city: 'Zirakpur' });
    const res = await order({ addressId: far });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('outside_delivery_area');
    expect(res.body.details.distanceKm).toBeGreaterThan(7);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT stock FROM store_inventory WHERE product_id = 1')).rows[0].stock).toBe(5);
  });

  it("can't deliver to someone else's saved address", async () => {
    const other = await registerAndGetCookie(app, 'ravi@example.com');
    const theirs = await addAddress(app, other);
    expect((await order({ addressId: theirs })).body.error).toBe('address_not_found');
  });

  it('needs either a saved address or an address text', async () => {
    expect((await order({})).status).toBe(400);
  });
});
