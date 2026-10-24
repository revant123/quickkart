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

/**
 * A tiny shop for checkout tests: store 1, two products, one future slot.
 *   product 1: price Rs 50.00, `stock1` in stock
 *   product 2: price Rs 20.00, `stock2` in stock
 */
export async function seedShop(opts: { stock1?: number; stock2?: number; capacity?: number } = {}) {
  const { stock1 = 1, stock2 = 100, capacity = 100 } = opts;
  await pool.query(`
    INSERT INTO stores (name, city, pincode) VALUES ('Central', 'Chandigarh', '160017'),
                                                    ('North',   'Chandigarh', '160011');
    INSERT INTO categories (name, slug) VALUES ('Dairy', 'dairy');
    INSERT INTO products (category_id, name, unit) VALUES (1, 'Milk', '1 l'), (1, 'Curd', '400 g');
  `);
  await pool.query(
    `INSERT INTO store_inventory (store_id, product_id, price_paise, stock)
     VALUES (1, 1, 5000, $1), (1, 2, 2000, $2)`,
    [stock1, stock2],
  );
  await pool.query(
    `INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity) VALUES
       (1, now() + interval '1 hour', now() + interval '90 minutes', $1),
       (1, now() - interval '2 hours', now() - interval '90 minutes', 5)`,
    [capacity],
  );
  return { storeId: 1, slotId: 1, pastSlotId: 2, milkId: 1, curdId: 2 };
}

/** Current stock of a product in store 1. */
export async function stockOf(productId: number): Promise<number> {
  const { rows } = await pool.query(
    'SELECT stock FROM store_inventory WHERE store_id = 1 AND product_id = $1',
    [productId],
  );
  return rows[0].stock;
}

/** How many places are booked in a slot. */
export async function bookedIn(slotId: number): Promise<number> {
  const { rows } = await pool.query('SELECT booked FROM delivery_slots WHERE id = $1', [slotId]);
  return rows[0].booked;
}

export async function countRows(table: 'orders' | 'order_items' | 'idempotency_keys') {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n as number;
}

/** Extracts "session=..." from a response's Set-Cookie header. */
export function sessionCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const found = raw?.find((c) => c.startsWith('session='));
  if (!found) throw new Error('no session cookie in response');
  return found.split(';')[0];
}
