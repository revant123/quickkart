import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { drainOutbox, enqueue, setMailer, type OutgoingMail } from '../src/notifications/outbox.js';
import { addAddress, locateStores, outbox, registerAndGetCookie, resetDb, seedShop } from './helpers.js';

const app = buildApp();
let sent: OutgoingMail[];
let restore: ReturnType<typeof setMailer>;

beforeEach(async () => {
  await resetDb();
  sent = [];
  restore = setMailer(async (m) => {
    sent.push(m);
  });
});
afterEach(() => {
  setMailer(restore);
});

describe('notifications outbox', () => {
  it('sends pending messages and marks them sent', async () => {
    await registerAndGetCookie(app);
    expect(await drainOutbox()).toEqual({ sent: 1, failed: 0 });
    expect(sent[0]).toMatchObject({ to: 'asha@example.com', subject: 'Confirm your email for QuickKart' });
    expect(sent[0].html).toContain('Confirm email');
    expect((await outbox())[0].status).toBe('sent');
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 0 }); // nothing sent twice
  });

  it('a cash order queues an email and an SMS, delivered to the inbox as a labelled text', async () => {
    await seedShop({ stock1: 5 });
    await locateStores();
    const cookie = await registerAndGetCookie(app);
    const addressId = await addAddress(app, cookie);
    await request(app).post('/api/orders').set('Cookie', cookie).set('Idempotency-Key', 'k1')
      .send({ storeId: 1, slotId: 1, addressId, items: [{ productId: 1, quantity: 2 }] }).expect(201);

    const placed = await outbox('order_placed');
    expect(placed.map((m) => [m.channel, m.recipient])).toEqual([
      ['email', 'asha@example.com'],
      ['sms', '9876543210'],
    ]);
    await drainOutbox();
    const sms = sent.find((m) => m.to.startsWith('9876543210@'))!;
    expect(sms.subject).toBe('SMS to +91 9876543210');
    expect(sms.text).toMatch(/^QuickKart: order #1 placed, .*Pay ₹100\.00 in cash/);
  });

  it('nothing is queued if the change rolls back (out of stock)', async () => {
    await seedShop({ stock1: 1 });
    const cookie = await registerAndGetCookie(app);
    await pool.query('DELETE FROM outbox');
    const res = await request(app).post('/api/orders').set('Cookie', cookie).set('Idempotency-Key', 'k1')
      .send({ storeId: 1, slotId: 1, address: '12 Sector 17', items: [{ productId: 1, quantity: 3 }] });
    expect(res.status).toBe(409);
    expect(await outbox()).toHaveLength(0);
  });

  it('retries a failed send later, and gives up after 8 attempts', async () => {
    await enqueue(pool, 'email', 'asha@example.com', 'order_delivered', { name: 'Asha', orderId: '7', totalPaise: 100 });
    setMailer(async () => {
      throw new Error('SMTP down');
    });
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 1 });
    let { rows } = await pool.query('SELECT status, attempts, last_error, next_attempt_at > now() AS later FROM outbox');
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'SMTP down', later: true });
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 0 }); // not due yet: backoff

    await pool.query('UPDATE outbox SET attempts = 7, next_attempt_at = now()');
    await drainOutbox();
    ({ rows } = await pool.query('SELECT status, attempts FROM outbox'));
    expect(rows[0]).toEqual({ status: 'failed', attempts: 8 });
  });

  it('a message whose sender crashed mid-send is retried when its lease runs out', async () => {
    await enqueue(pool, 'email', 'asha@example.com', 'order_delivered', { name: 'Asha', orderId: '7', totalPaise: 100 });
    // Simulate: claimed (lease taken), then the process died before marking it sent
    await pool.query(`UPDATE outbox SET attempts = 1, next_attempt_at = now() + interval '2 minutes'`);
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 0 });
    await pool.query(`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`); // lease expired
    expect(await drainOutbox()).toEqual({ sent: 1, failed: 0 });
  });
});
