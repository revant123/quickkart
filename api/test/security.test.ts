import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, registerAndGetCookie, seedShop } from './helpers.js';

const app = buildApp();

afterAll(() => pool.end());
beforeEach(resetDb);

describe('sessions are checked against the database on every request', () => {
  it('a role change applies immediately, without logging in again', async () => {
    const cookie = await registerAndGetCookie(app);
    expect((await request(app).get('/api/admin/orders').set('Cookie', cookie)).status).toBe(403);

    await pool.query(`UPDATE users SET role = 'admin' WHERE email = 'asha@example.com'`);
    expect((await request(app).get('/api/admin/orders').set('Cookie', cookie)).status).toBe(200);

    await pool.query(`UPDATE users SET role = 'customer' WHERE email = 'asha@example.com'`);
    expect((await request(app).get('/api/admin/orders').set('Cookie', cookie)).status).toBe(403);
  });

  it('"log out everywhere" kills every existing session', async () => {
    const laptop = await registerAndGetCookie(app);
    const phone = (
      await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'correct-horse-1' })
    ).headers['set-cookie'] as unknown as string[];
    const phoneCookie = phone[0].split(';')[0];

    expect((await request(app).get('/api/auth/me').set('Cookie', phoneCookie)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout-all').set('Cookie', laptop)).status).toBe(204);

    expect((await request(app).get('/api/auth/me').set('Cookie', laptop)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', phoneCookie)).status).toBe(401);
  });

  it('a deleted user can no longer use their token', async () => {
    const cookie = await registerAndGetCookie(app);
    await pool.query('DELETE FROM users');
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('never returns the password hash or token version', async () => {
    const cookie = await registerAndGetCookie(app);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.body.password_hash).toBeUndefined();
    expect(me.body.token_version).toBeUndefined();
    expect(me.body).toMatchObject({ email: 'asha@example.com', role: 'customer', email_verified: false });
  });
});

describe('rate limiting', () => {
  // A fresh app with tiny limits for each test, so counts don't carry over
  const tiny = (authPer15Min = 3) =>
    buildApp({ rateLimits: { authPer15Min, checkoutPerMin: 2, apiPerMin: 1000 } });

  it('blocks password guessing after the limit with 429 and RateLimit headers', async () => {
    const limited = tiny();
    const tryLogin = () =>
      request(limited).post('/api/auth/login').send({ email: 'x@example.com', password: 'wrong-pass-1' });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await tryLogin()).status);
    expect(statuses).toEqual([401, 401, 401, 429, 429]);

    const blocked = await tryLogin();
    expect(blocked.body.error).toBe('rate_limited');
    expect(blocked.headers['ratelimit-policy']).toBeDefined();
  });

  it('limits checkouts per user, not per IP', async () => {
    await seedShop({ stock1: 50 });
    const limited = tiny(10);
    const a = await registerAndGetCookie(limited, 'a@example.com');
    const b = await registerAndGetCookie(limited, 'b@example.com');
    const order = (cookie: string) =>
      request(limited)
        .post('/api/orders')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ storeId: 1, slotId: 1, address: '12 Sector 17, Chandigarh', items: [{ productId: 1, quantity: 1 }] });

    expect([(await order(a)).status, (await order(a)).status, (await order(a)).status]).toEqual([201, 201, 429]);
    // b shares the same IP but has their own allowance
    expect((await order(b)).status).toBe(201);
  });
});
