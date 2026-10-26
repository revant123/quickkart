import type { Queryable } from '../../db.js';
import { HttpError } from '../../errors.js';

// ---------------------------------------------------------------------------
// Which store delivers to a point? Distances use km_between() (haversine, in
// migration 0004). With a handful of stores a full scan is instant; with
// thousands you'd add PostGIS and a spatial index (docs/scaling.md).
// ---------------------------------------------------------------------------

export type Point = { lat: number; lng: number };

export type NearestStore = {
  id: string;
  name: string;
  city: string;
  pincode: string;
  address: string | null;
  distance_km: number;
  radius_km: number;
  delivers: boolean;
};

/** Stores ordered by distance from a point, each marked with whether it delivers there. */
export async function storesByDistance(db: Queryable, p: Point): Promise<NearestStore[]> {
  const { rows } = await db.query(
    `SELECT id, name, city, pincode, address, radius_km,
            round(km_between(lat, lng, $1, $2)::numeric, 1)::float8 AS distance_km,
            km_between(lat, lng, $1, $2) <= radius_km AS delivers
       FROM stores
      WHERE is_active AND lat IS NOT NULL
      ORDER BY km_between(lat, lng, $1, $2)`,
    [p.lat, p.lng],
  );
  return rows;
}

/** The centre point of a pincode we know, or 404 pincode_unknown. */
export async function pincodePoint(db: Queryable, pincode: string) {
  const { rows } = await db.query(
    'SELECT pincode, area, city, state, lat, lng, precise FROM pincodes WHERE pincode = $1',
    [pincode],
  );
  if (!rows[0]) throw new HttpError(404, 'pincode_unknown');
  return rows[0] as {
    pincode: string; area: string; city: string; state: string | null; lat: number; lng: number;
    /** false: India Post's estimate, right town but possibly 10-40 km off */
    precise: boolean;
  };
}

/**
 * Throws 409 outside_delivery_area unless `storeId` delivers to point `p`.
 * A store without a location (old data) accepts every address.
 */
export async function assertDelivers(db: Queryable, storeId: number, p: Point) {
  const { rows } = await db.query(
    `SELECT lat IS NULL OR km_between(lat, lng, $2, $3) <= radius_km AS ok,
            round(km_between(lat, lng, $2, $3)::numeric, 1)::float8 AS distance_km, radius_km
       FROM stores WHERE id = $1`,
    [storeId, p.lat, p.lng],
  );
  if (!rows[0]) throw new HttpError(404, 'store_not_found');
  if (!rows[0].ok) {
    throw new HttpError(409, 'outside_delivery_area', {
      distanceKm: rows[0].distance_km,
      radiusKm: rows[0].radius_km,
    });
  }
}
