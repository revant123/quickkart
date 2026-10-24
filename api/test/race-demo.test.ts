import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';
import { naivePlaceOrder } from '../src/modules/orders/naiveCheckout.js';
import { placeOrder } from '../src/modules/orders/placeOrder.js';
import { resetDb, seedShop, stockOf, countRows } from './helpers.js';

// ---------------------------------------------------------------------------
// THE RACE-CONDITION DEMO
// Ten customers try to buy the LAST carton of milk (stock = 1) at the same moment.
//   naive checkout (read, check, write) -> sells it several times   (BUG)
//   real checkout  (atomic UPDATE)      -> sells it exactly once    (FIXED)
// Run just this file:  npx vitest run test/race-demo.test.ts
// ---------------------------------------------------------------------------

const BUYERS = 10;

async function makeUser(): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name) VALUES ('demo@example.com', 'x', 'Demo')
     RETURNING id`,
  );
  return Number(rows[0].id);
}

describe('race-condition demo: 10 buyers, 1 carton of milk', () => {
  beforeEach(resetDb);
  afterAll(() => pool.end());

  it('NAIVE checkout oversells (this is the bug)', async () => {
    const { storeId, milkId, slotId } = await seedShop({ stock1: 1 });
    const userId = await makeUser();

    const results = await Promise.allSettled(
      Array.from({ length: BUYERS }, () => naivePlaceOrder(userId, storeId, milkId, slotId)),
    );
    const sold = results.filter((r) => r.status === 'fulfilled').length;

    console.log(
      `\n  NAIVE: ${BUYERS} buyers, 1 in stock -> ${sold} orders created, ` +
        `stock now ${await stockOf(milkId)}   <-- OVERSOLD by ${sold - 1}`,
    );
    expect(sold).toBeGreaterThan(1); // proves the bug exists
    expect(await countRows('orders')).toBe(sold);
  });

  it('REAL checkout sells exactly once (the fix)', async () => {
    const { storeId, milkId, slotId } = await seedShop({ stock1: 1 });
    const userId = await makeUser();
    const input = {
      storeId, slotId, address: '12 Sector 17, Chandigarh',
      items: [{ productId: milkId, quantity: 1 }],
    };

    const results = await Promise.allSettled(
      Array.from({ length: BUYERS }, () => placeOrder(userId, randomUUID(), input)),
    );
    const sold = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected').length;

    console.log(
      `  REAL:  ${BUYERS} buyers, 1 in stock -> ${sold} order created, ` +
        `${refused} told "out of stock", stock now ${await stockOf(milkId)}   <-- CORRECT\n`,
    );
    expect(sold).toBe(1);
    expect(refused).toBe(BUYERS - 1);
    expect(await stockOf(milkId)).toBe(0);
  });
});
