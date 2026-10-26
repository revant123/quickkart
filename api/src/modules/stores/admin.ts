import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { HttpError } from '../../errors.js';
import { openSlots } from '../../jobs.js';
import { pincodePoint } from '../location/geo.js';

// ---------------------------------------------------------------------------
// Admin: opening and managing dark stores anywhere in India.
// Mounted under /api/admin (requireAuth + requireRole('admin')).
//
// A new store gets, in ONE transaction: its row (location from the pincode, or exact
// coordinates if given), its own selection of the catalogue (stock_store(), ~60% of
// products with their own prices) and delivery slots for the next 2 days. Either the
// store is ready to sell, or it doesn't exist.
// ---------------------------------------------------------------------------

export const adminStoresRouter = Router();

const Id = z.coerce.number().int().positive();

// GET /api/admin/stores -> every store, open or closed, with how many products it stocks
adminStoresRouter.get('/stores', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.city, s.pincode, s.address, s.lat, s.lng, s.radius_km, s.is_active,
            coalesce(inv.products, 0)::int AS products
       FROM stores s
       LEFT JOIN (SELECT store_id, count(*) AS products FROM store_inventory GROUP BY store_id) inv
              ON inv.store_id = s.id
      ORDER BY s.city, s.name`,
  );
  res.json(rows);
});

const NewStore = z.object({
  name: z.string().trim().min(3).max(60),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'a 6-digit pincode'),
  address: z.string().trim().max(120).optional(),
  // Exact location (e.g. from the admin's phone). Without it, the pincode's centre is used.
  lat: z.number().min(6).max(37.5).optional(),
  lng: z.number().min(68).max(97.5).optional(),
  radiusKm: z.number().min(1).max(30).default(7),
});

// POST /api/admin/stores -> 201 new store, stocked and with slots
// 400 | 404 pincode_unknown | 409 store_name_taken
adminStoresRouter.post('/stores', async (req, res) => {
  const body = NewStore.parse(req.body);
  const store = await withTransaction(async (db) => {
    const place = await pincodePoint(db, body.pincode);
    const exact = body.lat !== undefined && body.lng !== undefined;
    const taken = await db.query('SELECT 1 FROM stores WHERE lower(name) = lower($1)', [body.name]);
    if (taken.rowCount) throw new HttpError(409, 'store_name_taken');
    const { rows } = await db.query(
      `INSERT INTO stores (name, city, pincode, address, lat, lng, radius_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, city, pincode, address, lat, lng, radius_km, is_active`,
      [body.name, place.city, body.pincode, body.address || `${place.area}, ${place.city}`,
        exact ? body.lat : place.lat, exact ? body.lng : place.lng, body.radiusKm],
    );
    const { rows: stocked } = await db.query('SELECT stock_store($1) AS n', [rows[0].id]);
    const slots = await openSlots(db, Number(rows[0].id));
    return { ...rows[0], products: stocked[0].n, slots };
  });
  res.status(201).json(store);
});

const StorePatch = z
  .object({
    name: z.string().trim().min(3).max(60).optional(),
    address: z.string().trim().max(120).optional(),
    radiusKm: z.number().min(1).max(30).optional(),
    // Closing a store hides it from customers; its orders and data stay.
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to update' });

// PATCH /api/admin/stores/:id -> 200 | 404
adminStoresRouter.patch('/stores/:id', async (req, res) => {
  const id = Id.parse(req.params.id);
  const b = StorePatch.parse(req.body);
  const { rows } = await pool.query(
    `UPDATE stores SET name = coalesce($2, name), address = coalesce($3, address),
            radius_km = coalesce($4, radius_km), is_active = coalesce($5, is_active)
      WHERE id = $1
      RETURNING id, name, city, pincode, address, lat, lng, radius_km, is_active`,
    [id, b.name ?? null, b.address ?? null, b.radiusKm ?? null, b.isActive ?? null],
  );
  if (!rows[0]) throw new HttpError(404, 'store_not_found');
  if (b.isActive) await openSlots(pool, id); // reopened: make sure it's bookable
  res.json(rows[0]);
});
