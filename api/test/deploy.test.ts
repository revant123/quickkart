import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { keepSlotsOpen } from '../src/jobs.js';
import { seedIfEmpty } from '../src/seed.js';
import { drainOutbox, enqueue, setMailer, toMail } from '../src/notifications/outbox.js';
import { resetDb, seedShop } from './helpers.js';

beforeEach(resetDb);

describe('one container serves the website and the API', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qk-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');

  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    config.STATIC_DIR = dir;
    app = buildApp();
  });
  afterEach(() => {
    config.STATIC_DIR = undefined;
  });

  it('serves the page for / and for app routes, never cached', async () => {
    for (const path of ['/', '/orders/42', '/admin/riders']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('caches hashed assets for a year', async () => {
    const res = await request(app).get('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('unknown API paths are still JSON 404s, not the web page', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});

describe('fresh deploys', () => {
  it('loads the sample data only when the database is empty', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'qk-seed-')), 'seed.sql');
    writeFileSync(file, `INSERT INTO stores (name, city, pincode) VALUES ('Seeded', 'Chandigarh', '160017');
                         INSERT INTO categories (name, slug) VALUES ('Dairy', 'dairy');`);
    const quiet = () => {};
    expect(await seedIfEmpty(pool, file, quiet)).toBe(true);
    expect(await seedIfEmpty(pool, file, quiet)).toBe(false); // second start: untouched
    expect((await pool.query('SELECT count(*)::int AS n FROM stores')).rows[0].n).toBe(1);
  });

  it('a broken seed file leaves nothing half-loaded', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'qk-seed-')), 'seed.sql');
    writeFileSync(file, `INSERT INTO stores (name, city, pincode) VALUES ('Half', 'Chandigarh', '160017');
                         INSERT INTO no_such_table VALUES (1);`);
    await expect(seedIfEmpty(pool, file, () => {})).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS n FROM stores')).rows[0].n).toBe(0);
  });

  it('keeps 30-minute delivery slots open for two days, without duplicating', async () => {
    await seedShop(); // 2 stores
    const before = (await pool.query('SELECT count(*)::int AS n FROM delivery_slots')).rows[0].n;
    expect(await keepSlotsOpen.run()).toMatch(/^opened \d+ delivery slots$/);
    const after = (await pool.query('SELECT count(*)::int AS n FROM delivery_slots')).rows[0].n;
    expect(after - before).toBeGreaterThanOrEqual(2 * 94);
    expect(await keepSlotsOpen.run()).toBeUndefined(); // nothing new to open
  });
});

describe('email on a host that blocks SMTP (Resend HTTPS API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    Object.assign(config, { RESEND_API_KEY: 're_test_123', MAIL_REDIRECT_TO: undefined });
    setMailer(null); // rebuild the mailer from config
    fetchMock = vi.fn(async () => new Response('{"id":"em_1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    Object.assign(config, { RESEND_API_KEY: undefined, MAIL_REDIRECT_TO: undefined });
    setMailer(null);
    vi.unstubAllGlobals();
  });

  it('sends through the API with an idempotency key per message', async () => {
    await enqueue(pool, 'email', 'asha@example.com', 'order_delivered', { name: 'Asha', orderId: '7', totalPaise: 100 });
    expect(await drainOutbox()).toEqual({ sent: 1, failed: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test_123');
    expect(init.headers['Idempotency-Key']).toMatch(/^quickkart-outbox-\d+$/);
    expect(JSON.parse(init.body)).toMatchObject({ to: ['asha@example.com'], subject: 'Order #7 delivered' });
  });

  it('a Resend error is retried later like any other failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"message":"invalid from"}', { status: 422 }));
    await enqueue(pool, 'email', 'asha@example.com', 'order_delivered', { name: 'Asha', orderId: '7', totalPaise: 100 });
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 1 });
    const { rows } = await pool.query('SELECT status, last_error FROM outbox');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].last_error).toContain('Resend 422');
  });

  it('demo mode sends everything to one inbox, labelled with the real recipient', () => {
    config.MAIL_REDIRECT_TO = 'me@example.com';
    const email = toMail({ id: 1, channel: 'email', recipient: 'asha@example.com', template: 'order_delivered',
      data: { name: 'Asha', orderId: '7', totalPaise: 100 } as never });
    expect(email).toMatchObject({ to: 'me@example.com', subject: '[for asha@example.com] Order #7 delivered' });
    const sms = toMail({ id: 2, channel: 'sms', recipient: '9876543210', template: 'order_out_for_delivery',
      data: { name: 'Asha', orderId: '7', riderName: 'Ravi', totalPaise: 100, cashDue: false } as never });
    expect(sms).toMatchObject({ to: 'me@example.com', subject: 'SMS to +91 9876543210' });
  });
});

describe('admins without a shell', () => {
  afterEach(() => {
    config.ADMIN_EMAILS = [];
  });
  it('registering with an email in ADMIN_EMAILS makes an admin; others stay customers', async () => {
    config.ADMIN_EMAILS = ['boss@example.com'];
    const app = buildApp();
    const boss = await request(app).post('/api/auth/register').send({ email: 'Boss@Example.com', password: 'correct-horse-1', name: 'Boss' });
    expect(boss.body.role).toBe('admin');
    const other = await request(app).post('/api/auth/register').send({ email: 'asha@example.com', password: 'correct-horse-1', name: 'Asha' });
    expect(other.body.role).toBe('customer');
  });
});
