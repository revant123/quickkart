import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { outbox, placeTestOrder, registerAdmin, registerAndGetCookie, resetDb, seedShop } from './helpers.js';

const app = buildApp();
let admin: string;
let customer: string;

async function makeRider(email: string, storeId = 1) {
  const cookie = await registerAndGetCookie(app, email);
  await request(app).post('/api/admin/riders').set('Cookie', admin).send({ email, storeId }).expect(200);
  return cookie; // same cookie works: the role is read from the database on each request
}
async function packedOrder(payment: 'cod' | 'online' = 'cod') {
  const id = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
  if (payment === 'online') await pool.query(`UPDATE orders SET payment_method = 'online', payment_status = 'paid'`);
  await request(app).patch(`/api/admin/orders/${id}/status`).set('Cookie', admin).send({ status: 'PACKED' }).expect(200);
  return id;
}

beforeEach(async () => {
  await resetDb();
  await seedShop({ stock1: 50 });
  admin = await registerAdmin(app);
  customer = await registerAndGetCookie(app, 'asha@example.com');
});

describe('riders', () => {
  it('only riders can use the rider API', async () => {
    expect((await request(app).get('/api/rider/orders').set('Cookie', customer)).status).toBe(403);
    expect((await request(app).get('/api/rider/orders')).status).toBe(401);
  });

  it('a rider sees packed orders of their own store, ready to pick up', async () => {
    const rider = await makeRider('ravi@example.com');
    const id = await packedOrder();
    await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]); // PLACED, not packed yet
    const res = await request(app).get('/api/rider/orders').set('Cookie', rider);
    expect(res.body.ready.map((o: any) => o.id)).toEqual([id]);
    expect(res.body.ready[0]).toMatchObject({ payment_method: 'cod', total_paise: 5000, item_count: 1 });

    const other = await makeRider('neha@example.com', 2);
    expect((await request(app).get('/api/rider/orders').set('Cookie', other)).body.ready).toEqual([]);
    expect((await request(app).post(`/api/rider/orders/${id}/pickup`).set('Cookie', other)).status).toBe(404);
  });

  it('5 riders tap "Pick up" on the same order at once: exactly one gets it', async () => {
    const riders = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => makeRider(`rider-${x}@example.com`)));
    const id = await packedOrder();
    const results = await Promise.all(
      riders.map((r) => request(app).post(`/api/rider/orders/${id}/pickup`).set('Cookie', r)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error === 'already_taken')).toHaveLength(4);
    const { rows } = await pool.query('SELECT status, rider_id FROM orders WHERE id = $1', [id]);
    expect(rows[0].status).toBe('OUT_FOR_DELIVERY');
    // The customer is told who's coming (email; also SMS when the order has a phone number)
    expect((await outbox('order_out_for_delivery')).map((m) => m.channel)).toEqual(['email']);
  });

  it('delivering a cash order marks it paid; only the rider who has it can deliver', async () => {
    const ravi = await makeRider('ravi@example.com');
    const neha = await makeRider('neha@example.com');
    const id = await packedOrder();
    await request(app).post(`/api/rider/orders/${id}/pickup`).set('Cookie', ravi).expect(200);
    expect((await request(app).get('/api/rider/orders').set('Cookie', ravi)).body.mine).toHaveLength(1);

    expect((await request(app).post(`/api/rider/orders/${id}/deliver`).set('Cookie', neha)).status).toBe(404);
    await request(app).post(`/api/rider/orders/${id}/deliver`).set('Cookie', ravi).expect(200);
    const { rows } = await pool.query('SELECT status, payment_status, delivered_at FROM orders');
    expect(rows[0]).toMatchObject({ status: 'DELIVERED', payment_status: 'paid' });
    expect(rows[0].delivered_at).not.toBeNull();
    expect(await outbox('order_delivered')).toHaveLength(1);
    // Can't deliver twice
    expect((await request(app).post(`/api/rider/orders/${id}/deliver`).set('Cookie', ravi)).status).toBe(409);
  });

  it("a rider can't pick up an order that isn't packed yet", async () => {
    const rider = await makeRider('ravi@example.com');
    const id = await placeTestOrder(app, customer, [{ productId: 1, quantity: 1 }]);
    expect((await request(app).post(`/api/rider/orders/${id}/pickup`).set('Cookie', rider)).body.error).toBe('not_ready');
  });

  it('admins manage riders; a rider out on a delivery cannot be removed', async () => {
    const rider = await makeRider('ravi@example.com');
    const list = (await request(app).get('/api/admin/riders').set('Cookie', admin)).body;
    expect(list).toMatchObject([{ email: 'ravi@example.com', store_name: 'Central', on_the_way: 0 }]);
    const riderId = list[0].id;

    const id = await packedOrder();
    await request(app).post(`/api/rider/orders/${id}/pickup`).set('Cookie', rider).expect(200);
    expect((await request(app).delete(`/api/admin/riders/${riderId}`).set('Cookie', admin)).body.error)
      .toBe('rider_has_deliveries');
    await request(app).post(`/api/rider/orders/${id}/deliver`).set('Cookie', rider).expect(200);
    await request(app).delete(`/api/admin/riders/${riderId}`).set('Cookie', admin).expect(204);
    expect((await request(app).get('/api/rider/orders').set('Cookie', rider)).status).toBe(403); // at once
  });

  it("an admin can't be turned into a rider, and unknown emails are 404", async () => {
    expect((await request(app).post('/api/admin/riders').set('Cookie', admin)
      .send({ email: 'admin@example.com', storeId: 1 })).body.error).toBe('cannot_change_admin');
    expect((await request(app).post('/api/admin/riders').set('Cookie', admin)
      .send({ email: 'ghost@example.com', storeId: 1 })).status).toBe(404);
  });
});
