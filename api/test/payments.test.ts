import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { hmacHex } from '../src/modules/payments/gateway.js';
import { expireUnpaidOrders, processRefunds } from '../src/modules/payments/service.js';
import { bookedIn, outbox, registerAndGetCookie, resetDb, seedShop, stockOf } from './helpers.js';

const app = buildApp();
let cookie: string;

async function onlineOrder(quantity = 1) {
  const res = await request(app).post('/api/orders').set('Cookie', cookie).set('Idempotency-Key', `k-${Math.random()}`)
    .send({ storeId: 1, slotId: 1, address: '12 Sector 17, Chandigarh', paymentMethod: 'online',
      items: [{ productId: 1, quantity }] });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { orderId: string; status: string; paymentExpiresAt: string };
}
const start = (id: string) => request(app).post(`/api/orders/${id}/payment`).set('Cookie', cookie);
const fakePay = (providerOrderId: string, outcome = 'success') =>
  request(app).post('/api/payments/fake/pay').set('Cookie', cookie).send({ providerOrderId, outcome });
const verify = (id: string, body: object) =>
  request(app).post(`/api/orders/${id}/payment/verify`).set('Cookie', cookie).send(body);
const orderRow = async (id: string) =>
  (await pool.query('SELECT status, payment_status FROM orders WHERE id = $1', [id])).rows[0];

beforeEach(async () => {
  await resetDb();
  await seedShop({ stock1: 5 });
  cookie = await registerAndGetCookie(app);
});

describe('online payment with the built-in test gateway', () => {
  it('an online order waits for payment but already holds its stock and slot place', async () => {
    const o = await onlineOrder(2);
    expect(o.status).toBe('PENDING_PAYMENT');
    expect(new Date(o.paymentExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await stockOf(1)).toBe(3);
    expect(await bookedIn(1)).toBe(1);
    expect(await outbox('order_placed')).toHaveLength(0); // confirmation comes with the payment
  });

  it('start -> pay -> verify places the order, marks it paid and sends the confirmation', async () => {
    const o = await onlineOrder();
    const s1 = await start(o.orderId);
    expect(s1.status).toBe(200);
    expect(s1.body).toMatchObject({ provider: 'fake', amountPaise: 5000, currency: 'INR' });
    // Asking again gives the same gateway order (double-click safe)
    expect((await start(o.orderId)).body.providerOrderId).toBe(s1.body.providerOrderId);

    const paid = await fakePay(s1.body.providerOrderId);
    const v = await verify(o.orderId, paid.body);
    expect(v.body).toEqual({ orderId: o.orderId, status: 'PLACED', paymentStatus: 'paid' });
    expect(await outbox('order_placed')).toHaveLength(1);

    // Verifying the same payment again changes nothing and sends nothing new
    expect((await verify(o.orderId, paid.body)).body.status).toBe('PLACED');
    expect(await outbox('order_placed')).toHaveLength(1);
    expect((await start(o.orderId)).body.error).toBe('not_awaiting_payment');
  });

  it('a forged signature is refused', async () => {
    const o = await onlineOrder();
    const s = await start(o.orderId);
    const paid = (await fakePay(s.body.providerOrderId)).body;
    const forged = await verify(o.orderId, { ...paid, razorpay_signature: 'a'.repeat(64) });
    expect(forged.status).toBe(400);
    expect(forged.body.error).toBe('invalid_payment_signature');
    // Someone else's payment id with this order's signature: also refused
    expect((await verify(o.orderId, { ...paid, razorpay_payment_id: 'fake_pay_other' })).status).toBe(400);
    expect((await orderRow(o.orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('a declined payment leaves the order waiting, so the customer can try again', async () => {
    const o = await onlineOrder();
    const s = await start(o.orderId);
    expect((await fakePay(s.body.providerOrderId, 'failure')).status).toBe(402);
    expect((await orderRow(o.orderId)).status).toBe('PENDING_PAYMENT');
  });

  it("can't start paying for someone else's order", async () => {
    const o = await onlineOrder();
    const other = await registerAndGetCookie(app, 'ravi@example.com');
    expect((await request(app).post(`/api/orders/${o.orderId}/payment`).set('Cookie', other)).status).toBe(404);
  });

  it('unpaid orders are cancelled after the deadline and their stock and slot come back', async () => {
    const o = await onlineOrder(2);
    await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 second'`);
    await expireUnpaidOrders.run();
    expect(await orderRow(o.orderId)).toEqual({ status: 'CANCELLED', payment_status: 'failed' });
    expect(await stockOf(1)).toBe(5);
    expect(await bookedIn(1)).toBe(0);
    expect((await outbox('order_cancelled'))[0].data.reason).toBe('payment_expired');
  });

  it('the expiry job leaves orders alone until their deadline', async () => {
    const o = await onlineOrder();
    await expireUnpaidOrders.run();
    expect((await orderRow(o.orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('money that arrives after the order expired is refunded automatically', async () => {
    const o = await onlineOrder();
    const s = await start(o.orderId);
    const paid = (await fakePay(s.body.providerOrderId)).body;
    await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 second'`);
    await expireUnpaidOrders.run(); // cancelled just before the payment landed

    const v = await verify(o.orderId, paid);
    expect(v.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'refund_pending' });
    await processRefunds.run();
    expect((await orderRow(o.orderId)).payment_status).toBe('refunded');
    const { rows } = await pool.query('SELECT status, refund_id FROM payments');
    expect(rows[0].status).toBe('refunded');
    expect(rows[0].refund_id).toMatch(/^fake_rfnd_/);
    expect((await outbox('payment_refunded'))[0].data.amountPaise).toBe(5000);
  });

  it('cancelling a paid order refunds it', async () => {
    const o = await onlineOrder();
    const s = await start(o.orderId);
    await verify(o.orderId, (await fakePay(s.body.providerOrderId)).body);
    const c = await request(app).post(`/api/orders/${o.orderId}/cancel`).set('Cookie', cookie);
    expect(c.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'refund_pending' });
    expect((await outbox('order_cancelled'))[0].data.refundPaise).toBe(5000);
    await processRefunds.run();
    expect((await orderRow(o.orderId)).payment_status).toBe('refunded');
  });
});

describe('Razorpay mode (Razorpay itself replaced by a fake fetch)', () => {
  const KEY = 'rzp_test_abc';
  const SECRET = 'test_key_secret';
  const HOOK = 'test_webhook_secret';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.assign(config, { RAZORPAY_KEY_ID: KEY, RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK });
    let n = 0;
    fetchMock = vi.fn(async (url: string) => {
      n++;
      const body = url.endsWith('/refund') ? { id: `rfnd_${n}` } : { id: `order_${n}` };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    Object.assign(config, { RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, RAZORPAY_WEBHOOK_SECRET: undefined });
    vi.unstubAllGlobals();
  });

  const webhook = (event: object, opts: { secret?: string; id?: string } = {}) => {
    const raw = JSON.stringify(event);
    return request(app).post('/api/payments/razorpay/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', hmacHex(opts.secret ?? HOOK, raw))
      .set('x-razorpay-event-id', opts.id ?? 'evt_1')
      .send(raw);
  };
  const captured = (orderId: string, paymentId = 'pay_1') => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: 5000 } } },
  });

  it('creates a Razorpay order with the right amount, currency and basic auth', async () => {
    const o = await onlineOrder();
    const s = await start(o.orderId);
    expect(s.body).toMatchObject({ provider: 'razorpay', keyId: KEY, providerOrderId: 'order_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64'));
    expect(JSON.parse(init.body)).toMatchObject({ amount: 5000, currency: 'INR', receipt: `qk-order-${o.orderId}` });
  });

  it('checks the checkout signature exactly as Razorpay documents it', async () => {
    const o = await onlineOrder();
    await start(o.orderId);
    const sig = hmacHex(SECRET, 'order_1|pay_1');
    const v = await verify(o.orderId, { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sig });
    expect(v.body.status).toBe('PLACED');
  });

  it('a gateway outage is a clear 502, and the order stays payable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const o = await onlineOrder();
    const s = await start(o.orderId);
    expect(s.status).toBe(502);
    expect(s.body.error).toBe('payment_gateway_unreachable');
    expect((await start(o.orderId)).status).toBe(200);
  });

  it('the webhook places the order even if the customer closed the tab', async () => {
    const o = await onlineOrder();
    await start(o.orderId);
    const res = await webhook(captured('order_1'));
    expect(res.body).toEqual({ ok: true, result: 'recorded' });
    expect(await orderRow(o.orderId)).toEqual({ status: 'PLACED', payment_status: 'paid' });
  });

  it('the same webhook event twice is handled once', async () => {
    const o = await onlineOrder();
    await start(o.orderId);
    await webhook(captured('order_1'));
    expect((await webhook(captured('order_1'))).body.result).toBe('duplicate');
    expect(await outbox('order_placed')).toHaveLength(1);
  });

  it('browser and webhook reporting the same payment at the same moment: one confirmation', async () => {
    const o = await onlineOrder();
    await start(o.orderId);
    const sig = hmacHex(SECRET, 'order_1|pay_1');
    await Promise.all([
      verify(o.orderId, { razorpay_payment_id: 'pay_1', razorpay_signature: sig }),
      webhook(captured('order_1'), { id: 'evt_a' }),
      webhook({ ...captured('order_1'), event: 'order.paid' }, { id: 'evt_b' }),
    ]);
    expect(await orderRow(o.orderId)).toEqual({ status: 'PLACED', payment_status: 'paid' });
    expect(await outbox('order_placed')).toHaveLength(1);
  });

  it('refuses a webhook signed with the wrong secret', async () => {
    const res = await webhook(captured('order_1'), { secret: 'wrong' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_webhook_signature');
  });

  it('refunds through the Razorpay refunds API', async () => {
    const o = await onlineOrder();
    await start(o.orderId);
    await webhook(captured('order_1', 'pay_9'));
    await request(app).post(`/api/orders/${o.orderId}/cancel`).set('Cookie', cookie).expect(200);
    await processRefunds.run();
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/refund'))!;
    expect(call[0]).toBe('https://api.razorpay.com/v1/payments/pay_9/refund');
    expect(JSON.parse(call[1].body)).toEqual({ amount: 5000 });
    expect((await orderRow(o.orderId)).payment_status).toBe('refunded');
  });
});
