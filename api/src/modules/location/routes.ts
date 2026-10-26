import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { pincodePoint, storesByDistance } from './geo.js';

export const locationRouter = Router();

const Pincode = z.string().regex(/^[1-9][0-9]{5}$/, 'a 6-digit pincode');
const NearestQuery = z.union([
  z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
  z.object({ pincode: Pincode }),
]);

// GET /api/stores/nearest?lat=30.74&lng=76.78   (from the phone's GPS)
// GET /api/stores/nearest?pincode=160017        (typed in)
// -> { point, stores: [...nearest first, each with distance_km and delivers] }
// 400 bad input | 404 pincode_unknown
locationRouter.get('/stores/nearest', async (req, res) => {
  const q = NearestQuery.parse(req.query);
  const point =
    'pincode' in q
      ? await pincodePoint(pool, q.pincode)
      : { lat: q.lat, lng: q.lng, pincode: null, area: null, city: null };
  res.json({ point, stores: await storesByDistance(pool, point) });
});

// GET /api/pincodes/:pincode -> area and city (to fill in the address form)
locationRouter.get('/pincodes/:pincode', async (req, res) => {
  res.json(await pincodePoint(pool, Pincode.parse(req.params.pincode)));
});

// ===========================================================================
// Saved addresses: /api/me/addresses (each customer sees only their own)
// ===========================================================================

export const addressesRouter = Router();
addressesRouter.use(requireAuth);

const MAX_ADDRESSES = 10;
const ADDRESS_FIELDS = 'id, label, line1, line2, city, pincode, phone, lat, lng, precise, is_default';

const AddressBody = z.object({
  label: z.string().trim().min(1).max(30).default('Home'),
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).optional().transform((v) => v || null),
  city: z.string().trim().min(2).max(60),
  pincode: Pincode,
  // Accepts "98765 43210", "+91 9876543210"... and stores the 10 digits
  phone: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
    .pipe(z.string().regex(/^[6-9][0-9]{9}$/, 'a 10-digit mobile number')),
  // From the phone's GPS. Without it the pincode's centre point is used.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
});
const Id = z.coerce.number().int().positive();

// GET /api/me/addresses -> my addresses, default first
addressesRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${ADDRESS_FIELDS} FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC`,
    [req.user!.id],
  );
  res.json(rows);
});

// POST /api/me/addresses -> 201 | 400 | 404 pincode_unknown | 409 too_many_addresses
addressesRouter.post('/', async (req, res) => {
  const body = AddressBody.parse(req.body);
  const userId = req.user!.id;
  const row = await withTransaction(async (db) => {
    // Lock this user's row so two "add address" requests can't both pass the limit
    await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const { rows: c } = await db.query('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1', [userId]);
    if (c[0].n >= MAX_ADDRESSES) throw new HttpError(409, 'too_many_addresses');

    const gps = body.lat !== undefined && body.lng !== undefined;
    const point = gps ? { lat: body.lat!, lng: body.lng!, precise: true } : await pincodePoint(db, body.pincode);
    // The first address is the default automatically
    const makeDefault = body.isDefault ?? c[0].n === 0;
    if (makeDefault) await db.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
    const { rows } = await db.query(
      `INSERT INTO addresses (user_id, label, line1, line2, city, pincode, phone, lat, lng, precise, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${ADDRESS_FIELDS}`,
      [userId, body.label, body.line1, body.line2, body.city, body.pincode, body.phone,
        point.lat, point.lng, point.precise, makeDefault],
    );
    return rows[0];
  });
  res.status(201).json(row);
});

// PATCH /api/me/addresses/:id { ...any fields } -> 200 | 404
addressesRouter.patch('/:id', async (req, res) => {
  const id = Id.parse(req.params.id);
  const body = AddressBody.partial().parse(req.body);
  const userId = req.user!.id;
  const row = await withTransaction(async (db) => {
    const { rows: cur } = await db.query(
      'SELECT * FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    if (!cur[0]) throw new HttpError(404, 'address_not_found');
    const next = { ...cur[0], ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
    // A new pincode without new GPS coordinates moves the point to that pincode's centre
    if (body.lat !== undefined && body.lng !== undefined) {
      next.precise = true; // fresh GPS fix
    } else if (body.pincode && body.pincode !== cur[0].pincode) {
      const p = await pincodePoint(db, body.pincode);
      Object.assign(next, { lat: p.lat, lng: p.lng, precise: p.precise });
    }
    if (body.isDefault) await db.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
    const { rows } = await db.query(
      `UPDATE addresses SET label = $3, line1 = $4, line2 = $5, city = $6, pincode = $7, phone = $8,
              lat = $9, lng = $10, precise = $11, is_default = $12
        WHERE id = $1 AND user_id = $2
        RETURNING ${ADDRESS_FIELDS}`,
      [id, userId, next.label, next.line1, next.line2, next.city, next.pincode, next.phone,
        next.lat, next.lng, next.precise, body.isDefault ?? cur[0].is_default],
    );
    return rows[0];
  });
  res.json(row);
});

// DELETE /api/me/addresses/:id -> 204 | 404. Past orders keep their copy of the address.
addressesRouter.delete('/:id', async (req, res) => {
  const id = Id.parse(req.params.id);
  const userId = req.user!.id;
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default',
      [id, userId],
    );
    if (!rows[0]) throw new HttpError(404, 'address_not_found');
    if (rows[0].is_default) {
      // Promote the newest remaining address so there's still a default
      await db.query(
        `UPDATE addresses SET is_default = true
          WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY id DESC LIMIT 1)`,
        [userId],
      );
    }
  });
  res.status(204).end();
});
