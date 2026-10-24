import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { outbox, registerAndGetCookie, resetDb, seedShop, sessionCookie } from './helpers.js';

const app = buildApp();
const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;

describe('email verification', () => {
  beforeEach(resetDb);
  afterEach(() => {
    config.REQUIRE_VERIFIED_EMAIL = false;
  });

  it('registering queues a "confirm your email" message in the same transaction', async () => {
    await registerAndGetCookie(app);
    const [msg] = await outbox('verify_email');
    expect(msg).toMatchObject({ channel: 'email', recipient: 'asha@example.com', status: 'pending' });
    expect(msg.data.link).toMatch(/\/verify-email\?token=[\w-]{43}$/);
  });

  it('the link verifies the email once; the database stores only a hash of the token', async () => {
    const cookie = await registerAndGetCookie(app);
    const token = tokenFrom((await outbox('verify_email'))[0].data.link);
    const { rows } = await pool.query('SELECT token_hash FROM user_tokens');
    expect(rows[0].token_hash).not.toContain(token);

    const ok = await request(app).post('/api/auth/verify-email').send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.email_verified).toBe(true);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.email_verified).toBe(true);
    // Single use
    expect((await request(app).post('/api/auth/verify-email').send({ token })).body.error).toBe('invalid_or_expired_token');
  });

  it('an expired link does nothing', async () => {
    await registerAndGetCookie(app);
    const token = tokenFrom((await outbox('verify_email'))[0].data.link);
    await pool.query(`UPDATE user_tokens SET expires_at = now() - interval '1 second'`);
    expect((await request(app).post('/api/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('resending cancels the old link', async () => {
    const cookie = await registerAndGetCookie(app);
    const first = tokenFrom((await outbox('verify_email'))[0].data.link);
    await request(app).post('/api/auth/resend-verification').set('Cookie', cookie).expect(202);
    const second = tokenFrom((await outbox('verify_email'))[1].data.link);
    expect((await request(app).post('/api/auth/verify-email').send({ token: first })).status).toBe(400);
    expect((await request(app).post('/api/auth/verify-email').send({ token: second })).status).toBe(200);
    expect((await request(app).post('/api/auth/resend-verification').set('Cookie', cookie)).body.error).toBe('already_verified');
  });

  it('when required, checkout waits until the email is verified', async () => {
    config.REQUIRE_VERIFIED_EMAIL = true;
    await seedShop({ stock1: 5 });
    const cookie = await registerAndGetCookie(app);
    const place = () =>
      request(app).post('/api/orders').set('Cookie', cookie).set('Idempotency-Key', `k-${Math.random()}`)
        .send({ storeId: 1, slotId: 1, address: '12 Sector 17, Chandigarh', items: [{ productId: 1, quantity: 1 }] });
    const blocked = await place();
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('email_not_verified');

    const token = tokenFrom((await outbox('verify_email'))[0].data.link);
    await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
    expect((await place()).status).toBe(201); // same cookie: verification is read from the DB
  });
});

describe('password reset', () => {
  beforeEach(resetDb);

  it('answers the same for unknown emails, so it reveals nothing', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(202);
    expect(await outbox('reset_password')).toHaveLength(0);
  });

  it('resets the password, logs out every session, and the link works once', async () => {
    const oldSession = await registerAndGetCookie(app, 'asha@example.com', 'old-password-1');
    await request(app).post('/api/auth/forgot-password').send({ email: 'ASHA@example.com' }).expect(202);
    const token = tokenFrom((await outbox('reset_password'))[0].data.link);

    await request(app).post('/api/auth/reset-password').send({ token, password: 'new-password-2' }).expect(204);
    // The old session (maybe an attacker's) is dead
    expect((await request(app).get('/api/auth/me').set('Cookie', oldSession)).status).toBe(401);
    // Old password fails, new one works
    expect((await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'old-password-1' })).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'asha@example.com', password: 'new-password-2' });
    expect(login.status).toBe(200);
    expect(login.body.email_verified).toBe(true); // opening the email proved the address works
    sessionCookie(login);
    // The link can't be used again
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'third-password-3' })).status).toBe(400);
  });

  it('two clicks on the same link at once: exactly one succeeds', async () => {
    await registerAndGetCookie(app);
    await request(app).post('/api/auth/forgot-password').send({ email: 'asha@example.com' });
    const token = tokenFrom((await outbox('reset_password'))[0].data.link);
    const results = await Promise.all(
      ['pass-word-aaa', 'pass-word-bbb'].map((password) =>
        request(app).post('/api/auth/reset-password').send({ token, password })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });

  it('rejects a weak new password', async () => {
    await registerAndGetCookie(app);
    await request(app).post('/api/auth/forgot-password').send({ email: 'asha@example.com' });
    const token = tokenFrom((await outbox('reset_password'))[0].data.link);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
  });
});
