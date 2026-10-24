import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { HttpError } from '../../errors.js';

// ---------------------------------------------------------------------------
// Payment gateways. Two implementations of the SAME interface:
//
//   razorpay  real Razorpay (test or live keys), over its REST API
//   fake      built in, for development and tests without an account. It signs
//             payments with the same algorithm Razorpay uses, so the code that
//             checks signatures is identical for both.
//
// Razorpay's rules (docs: razorpay.com/docs/payments/payment-gateway/...):
//   checkout signature = HMAC-SHA256(order_id + "|" + payment_id, KEY SECRET), hex
//   webhook signature  = HMAC-SHA256(raw request body, WEBHOOK SECRET), hex,
//                        in the X-Razorpay-Signature header
// ---------------------------------------------------------------------------

export type GatewayOrder = { id: string };

export interface PaymentGateway {
  provider: 'razorpay' | 'fake';
  /** Public key the browser needs to open the payment window */
  keyId: string;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<GatewayOrder>;
  refund(paymentId: string, amountPaise: number): Promise<{ id: string }>;
  /** HMAC of "order_id|payment_id" with the key secret */
  checkoutSignature(providerOrderId: string, paymentId: string): string;
  webhookSecret: string | undefined;
}

export const hmacHex = (secret: string, message: string | Buffer) =>
  createHmac('sha256', secret).update(message).digest('hex');

/** Compares two hex signatures in constant time (no timing leak of how many chars matched). */
export function signaturesMatch(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function razorpay(keyId: string, keySecret: string): PaymentGateway {
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  async function call(path: string, body: unknown) {
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1${path}`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000), // never let a slow gateway hang a request
      });
    } catch (e) {
      throw new HttpError(502, 'payment_gateway_unreachable', { message: (e as Error).message });
    }
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new HttpError(502, 'payment_gateway_error', { status: res.status, reason: data?.error?.description });
    }
    return data;
  }
  return {
    provider: 'razorpay',
    keyId,
    webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
    createOrder: (amount, receipt, notes) => call('/orders', { amount, currency: 'INR', receipt, notes }),
    refund: (paymentId, amount) => call(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount }),
    checkoutSignature: (orderId, paymentId) => hmacHex(keySecret, `${orderId}|${paymentId}`),
  };
}

/** Secret for the built-in test gateway, derived from JWT_SECRET so it differs per install */
const fakeSecret = () => hmacHex(config.JWT_SECRET, 'quickkart-fake-gateway');
const fakeId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;

const fake: PaymentGateway = {
  provider: 'fake',
  keyId: 'fake_key',
  webhookSecret: undefined,
  createOrder: async () => ({ id: fakeId('fake_order') }),
  refund: async () => ({ id: fakeId('fake_rfnd') }),
  checkoutSignature: (orderId, paymentId) => hmacHex(fakeSecret(), `${orderId}|${paymentId}`),
};

/** What the test gateway's "payment window" returns on success, signed like Razorpay does */
export function fakeCheckoutSuccess(providerOrderId: string) {
  const paymentId = fakeId('fake_pay');
  return {
    razorpay_order_id: providerOrderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: fake.checkoutSignature(providerOrderId, paymentId),
  };
}

/** Razorpay when both keys are set, otherwise the built-in test gateway. Read per call so tests can switch. */
export function getGateway(): PaymentGateway {
  return config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET
    ? razorpay(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET)
    : fake;
}
