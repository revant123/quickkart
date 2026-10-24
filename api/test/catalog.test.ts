import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb } from './helpers.js';

const app = buildApp();

/**
 * Small, predictable catalog:
 *   store 1 stocks: Apna Milk, Banana Chips, Cola 100% Juice, Fresh Milk, Milk Bread
 *   store 2 stocks: only Fresh Milk (at a different price) -> multi-store check
 *   store 3 is inactive
 */
async function seedCatalog() {
  await pool.query(`
    INSERT INTO stores (name, city, pincode, is_active) VALUES
      ('Central', 'Chandigarh', '160017', true),
      ('North',   'Chandigarh', '160011', true),
      ('Closed',  'Mohali',     '160062', false);
    INSERT INTO categories (name, slug) VALUES ('Dairy', 'dairy'), ('Snacks', 'snacks');
    INSERT INTO products (category_id, name, unit) VALUES
      (1, 'Apna Milk',        '500 ml'),
      (2, 'Banana Chips',     '150 g'),
      (2, 'Cola 100% Juice',  '1 l'),
      (1, 'Fresh Milk',       '1 l'),
      (2, 'Milk Bread',       '400 g');
    INSERT INTO store_inventory (store_id, product_id, price_paise, stock) VALUES
      (1, 1, 3000, 10), (1, 2, 4000, 0), (1, 3, 9000, 5), (1, 4, 6500, 3), (1, 5, 4500, 8),
      (2, 4, 7000, 1);
    INSERT INTO delivery_slots (store_id, starts_at, ends_at, capacity, booked) VALUES
      (1, now() + interval '1 hour',  now() + interval '90 minutes', 5, 0),
      (1, now() + interval '2 hours', now() + interval '150 minutes', 5, 5),   -- full
      (1, now() - interval '2 hours', now() - interval '90 minutes', 5, 0);    -- past
  `);
}

const names = (res: request.Response) => res.body.items.map((p: { name: string }) => p.name);

describe('catalog', () => {
  beforeEach(async () => {
    await resetDb();
    await seedCatalog();
  });
  afterAll(() => pool.end());

  it('lists only active stores', async () => {
    const res = await request(app).get('/api/stores');
    expect(res.status).toBe(200);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Central', 'North']);
  });

  it('lists categories', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual(['dairy', 'snacks']);
  });

  it('browsing lists products in catalogue (id) order; searching lists A to Z', async () => {
    // A product added last, whose name sorts first
    await pool.query(`INSERT INTO products (category_id, name, unit) VALUES (2, 'Aloo Bhujia', '200 g')`);
    await pool.query(`INSERT INTO store_inventory (store_id, product_id, price_paise, stock) VALUES (1, 6, 3500, 4)`);

    const browse = await request(app).get('/api/stores/1/products');
    expect(names(browse).at(-1)).toBe('Aloo Bhujia'); // newest id last
    const search = await request(app).get('/api/stores/1/products?q=a');
    expect(names(search)[0]).toBe('Aloo Bhujia'); // A to Z

    // browse cursors and search cursors both paginate without overlap
    for (const query of ['', '&q=a']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const url: string = `/api/stores/1/products?limit=2${query}` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
        const res = await request(app).get(url);
        seen.push(...names(res));
        cursor = res.body.nextCursor;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(query ? 5 : 6); // 'a' matches 5 of the 6 names
    }
  });

  it('returns products with price and in_stock', async () => {
    const res = await request(app).get('/api/stores/1/products');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual([
      'Apna Milk', 'Banana Chips', 'Cola 100% Juice', 'Fresh Milk', 'Milk Bread',
    ]);
    const chips = res.body.items.find((p: { name: string }) => p.name === 'Banana Chips');
    expect(chips).toMatchObject({ price_paise: 4000, in_stock: false });
    expect(chips.stock).toBeUndefined(); // exact stock is not exposed
    expect(res.body.nextCursor).toBeNull();
  });

  it('each store shows only its own products and prices', async () => {
    const res = await request(app).get('/api/stores/2/products');
    expect(names(res)).toEqual(['Fresh Milk']);
    expect(res.body.items[0].price_paise).toBe(7000);
  });

  it('search is case-insensitive and matches anywhere in the name', async () => {
    const res = await request(app).get('/api/stores/1/products?q=MILK');
    expect(names(res)).toEqual(['Apna Milk', 'Fresh Milk', 'Milk Bread']);
  });

  it('treats % in a search as a normal character, not a wildcard', async () => {
    const res = await request(app).get('/api/stores/1/products?q=' + encodeURIComponent('100%'));
    expect(names(res)).toEqual(['Cola 100% Juice']);
    const wild = await request(app).get('/api/stores/1/products?q=' + encodeURIComponent('%'));
    expect(names(wild)).toEqual(['Cola 100% Juice']);
  });

  it('filters by category, and combines with search', async () => {
    const dairy = await request(app).get('/api/stores/1/products?category=dairy');
    expect(names(dairy)).toEqual(['Apna Milk', 'Fresh Milk']);
    const both = await request(app).get('/api/stores/1/products?category=snacks&q=milk');
    expect(names(both)).toEqual(['Milk Bread']);
  });

  it('paginates with a cursor, with no overlaps or gaps', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string =
        '/api/stores/1/products?limit=2' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      seen.push(...names(res));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3); // 2 + 2 + 1
    expect(seen).toEqual([
      'Apna Milk', 'Banana Chips', 'Cola 100% Juice', 'Fresh Milk', 'Milk Bread',
    ]);
  });

  it('rejects bad input with 400', async () => {
    expect((await request(app).get('/api/stores/1/products?cursor=garbage')).status).toBe(400);
    expect((await request(app).get('/api/stores/1/products?limit=500')).status).toBe(400);
    expect((await request(app).get('/api/stores/abc/products')).status).toBe(400);
  });

  it('returns 404 for unknown or inactive stores', async () => {
    expect((await request(app).get('/api/stores/99/products')).status).toBe(404);
    expect((await request(app).get('/api/stores/3/products')).status).toBe(404);
  });

  it('slots: only upcoming slots with free capacity', async () => {
    const res = await request(app).get('/api/stores/1/slots');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].free).toBe(5);
  });
});
