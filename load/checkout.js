// Load test: many customers buying the SAME popular product at the same time
// (a flash sale). Run with: bash scripts/load-test.sh checkout
//
// Uses an OPEN model: orders ARRIVE at a fixed rate (like real customers),
// whether or not earlier ones have finished. A closed model (N users that wait
// for each reply) would quietly slow down when the server slows, hiding problems.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://web';
const RATE = Number(__ENV.RATE || 20); // orders per second
const PRODUCT_ID = Number(__ENV.PRODUCT_ID);
const SLOT_ID = Number(__ENV.SLOT_ID);
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  // k6 clears each virtual user's cookies after every iteration by default.
  // Keep them, so each customer stays logged in after registering once.
  noCookiesReset: true,
  scenarios: {
    flash_sale: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: '45s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    'http_req_duration{name:checkout}': ['p(95)<500'],
    'checks{check:order placed}': ['rate>0.99'],
  },
};

export function setup() {
  if (!PRODUCT_ID || !SLOT_ID) throw new Error('Run this through scripts/load-test.sh checkout');
}

export default function () {
  // Each virtual user registers once. k6 keeps its session cookie for later requests.
  if (__ITER === 0) {
    http.post(
      `${BASE}/api/auth/register`,
      JSON.stringify({ email: `vu${__VU}-${Date.now()}@load.test`, password: 'password123', name: 'Load test' }),
      { headers: JSON_HEADERS, tags: { name: 'register' } },
    );
  }

  const res = http.post(
    `${BASE}/api/orders`,
    JSON.stringify({
      storeId: 1,
      slotId: SLOT_ID,
      address: 'Load test street 1, Chandigarh',
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    }),
    {
      // A unique idempotency key per intended order
      headers: { ...JSON_HEADERS, 'Idempotency-Key': `load-${__VU}-${__ITER}-${Date.now()}` },
      tags: { name: 'checkout' },
    },
  );
  check(res, { 'order placed': (r) => r.status === 201 });
}
