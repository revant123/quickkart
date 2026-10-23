import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, registerAndGetCookie, sessionCookie } from './helpers.js';

const app = buildApp();

describe('auth', () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it('register returns 201 and sets an HttpOnly session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'Asha@Example.com', password: 'correct-horse-1', name: 'Asha' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'asha@example.com', role: 'customer' });
    expect(res.body.password_hash).toBeUndefined(); // never leak the hash
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerAndGetCookie(app);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'asha@example.com', password: 'another-pass-1', name: 'Copy' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('rejects invalid input with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short', name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('login with a wrong password returns 401', async () => {
    await registerAndGetCookie(app);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('/me needs a session: 401 without, the user with', async () => {
    await registerAndGetCookie(app);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@example.com', password: 'correct-horse-1' });
    expect(login.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set('Cookie', sessionCookie(login));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('asha@example.com');
  });

  it('a tampered token is rejected', async () => {
    const cookie = await registerAndGetCookie(app);
    const tampered = cookie.slice(0, -3) + 'xyz';
    const res = await request(app).get('/api/auth/me').set('Cookie', tampered);
    expect(res.status).toBe(401);
  });
});
