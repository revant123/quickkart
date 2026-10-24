import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { sniffImageType, MAX_IMAGE_BYTES } from '../src/modules/images/routes.js';
import { resetDb, registerAdmin, registerAndGetCookie, seedShop } from './helpers.js';

const app = buildApp();

// A real 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

afterAll(() => pool.end());

let admin: string;
beforeEach(async () => {
  await resetDb();
  await seedShop({ stock1: 5 });
  // A sample product named like the seed data, so it maps to an illustration
  await pool.query(
    `UPDATE products SET name = 'Malai paneer 42', image_url = '/img/products/paneer.svg' WHERE id = 1`,
  );
  admin = await registerAdmin(app);
});

const upload = (buf: Buffer, name = 'photo.png', cookie = admin) =>
  request(app).post('/api/admin/products/1/image').set('Cookie', cookie).attach('image', buf, name);

describe('product images', () => {
  it('recognises files by their bytes, not their names', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('admin uploads a photo; the shop shows it; it is served with long cache headers', async () => {
    const up = await upload(PNG);
    expect(up.status).toBe(201);
    expect(up.body.image_url).toMatch(/^\/api\/products\/1\/image\?v=\d+$/);

    const shop = await request(app).get('/api/stores/1/products');
    expect(shop.body.items.find((p: { id: string }) => p.id === '1').image_url).toBe(up.body.image_url);

    const img = await request(app).get(up.body.image_url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(img.body).equals(PNG)).toBe(true);
  });

  it('rejects a non-image renamed to .png (415)', async () => {
    const res = await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'evil.png');
    expect(res.status).toBe(415);
    expect(res.body.error).toBe('unsupported_image_type');
  });

  it('rejects files over 1 MB (413)', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('image_too_large');
  });

  it('customers cannot upload (403)', async () => {
    const customer = await registerAndGetCookie(app, 'c@example.com');
    expect((await upload(PNG, 'p.png', customer)).status).toBe(403);
  });

  it('removing the photo goes back to the illustration', async () => {
    await upload(PNG);
    const del = await request(app).delete('/api/admin/products/1/image').set('Cookie', admin);
    expect(del.body.image_url).toBe('/img/products/paneer.svg');
    expect((await request(app).get('/api/products/1/image')).status).toBe(404);
  });
});
