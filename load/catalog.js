// Load test: customers browsing and searching the shop.
// Run with: bash scripts/load-test.sh catalog
//
// "Virtual users" (VUs) act like shoppers: each one searches or browses, waits
// a moment, and repeats. We ramp up to 50 at once, hold, then ramp down.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://web';

export const options = {
  stages: [
    { duration: '20s', target: 50 }, // ramp up to 50 shoppers
    { duration: '40s', target: 50 }, // hold
    { duration: '10s', target: 0 }, // ramp down
  ],
  // The test FAILS if these aren't met: 95% of requests under 300 ms, under 1% errors
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

// Mix of popular words (many matches) and rare ones (few matches)
const SEARCHES = ['milk', 'paneer', 'chips', 'rice', 'atta', 'tea', 'banana', 'malai', '4242', 'basmati'];
const AISLES = ['dairy', 'fruits-vegetables', 'snacks', 'beverages', 'staples'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export default function () {
  const store = 1 + Math.floor(Math.random() * 3);
  const r = Math.random();
  let url;
  if (r < 0.5) url = `${BASE}/api/stores/${store}/products?q=${pick(SEARCHES)}&limit=24`;
  else if (r < 0.8) url = `${BASE}/api/stores/${store}/products?category=${pick(AISLES)}&limit=24`;
  else url = `${BASE}/api/stores/${store}/products?limit=24`;

  // `tags.name` groups all these URLs into one row in the results
  const res = http.get(url, { tags: { name: 'catalog' } });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.5 + Math.random()); // a shopper looks at the page for a moment
}
