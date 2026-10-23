import request from 'supertest';
import type { Express } from 'express';
import { pool } from '../src/db.js';

/** Empties every table so each test starts from a clean database. */
export async function resetDb() {
  await pool.query(`TRUNCATE users, stores, categories, products, store_inventory,
    delivery_slots, orders, order_items, idempotency_keys RESTART IDENTITY CASCADE`);
}

/** Registers a user and returns the session cookie to send with later requests. */
export async function registerAndGetCookie(
  app: Express,
  email = 'asha@example.com',
  password = 'correct-horse-1',
): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password, name: 'Test User' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return sessionCookie(res);
}

/** Extracts "session=..." from a response's Set-Cookie header. */
export function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const found = raw?.find((c) => c.startsWith('session='));
  if (!found) throw new Error('no session cookie in response');
  return found.split(';')[0];
}
