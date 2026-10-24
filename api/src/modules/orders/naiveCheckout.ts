import { pool } from '../../db.js';
import { HttpError } from '../../errors.js';

// ===========================================================================
//  DELIBERATELY BROKEN. NOT USED BY THE APP. Exists only for the race demo
//  in test/race-demo.test.ts, to show WHY placeOrder.ts is written the way it is.
// ===========================================================================
//
// The bug is "read, then check, then write" as separate steps:
//
//   Time | Request A            | Request B            | stock in DB
//   -----+----------------------+----------------------+------------
//   t1   | SELECT stock -> 1    |                      | 1
//   t2   |                      | SELECT stock -> 1    | 1
//   t3   | 1 >= 1, OK           |                      | 1
//   t4   |                      | 1 >= 1, OK           | 1
//   t5   | UPDATE stock = 0     |                      | 0
//   t6   |                      | UPDATE stock = 0     | 0
//   t7   | order created        | order created        | 0  <- 2 sold, 1 existed
//
// Both read the same old value; the second write silently overwrites the first.
// This is the "lost update" anomaly. Stock ends at 0 (not negative), so even the
// CHECK (stock >= 0) constraint never notices. Wrapping these statements in
// BEGIN/COMMIT would NOT fix it: a plain SELECT takes no lock, so B can still
// read 1 before A writes.

export async function naivePlaceOrder(
  userId: number,
  storeId: number,
  productId: number,
  slotId: number,
) {
  // 1. READ
  const { rows } = await pool.query(
    'SELECT stock, price_paise FROM store_inventory WHERE store_id = $1 AND product_id = $2',
    [storeId, productId],
  );
  const inv = rows[0];

  // 2. CHECK
  if (!inv || inv.stock < 1) throw new HttpError(409, 'out_of_stock');

  // Simulates a little real-world work (e.g. a network hop), widening the race window
  await new Promise((r) => setTimeout(r, 50));

  // 3. WRITE: an ABSOLUTE value computed from the stale read
  await pool.query(
    'UPDATE store_inventory SET stock = $3 WHERE store_id = $1 AND product_id = $2',
    [storeId, productId, inv.stock - 1],
  );
  const { rows: orderRows } = await pool.query(
    `INSERT INTO orders (user_id, store_id, slot_id, total_paise, address)
     VALUES ($1, $2, $3, $4, 'naive demo') RETURNING id`,
    [userId, storeId, slotId, inv.price_paise],
  );
  return orderRows[0].id as string;
}
