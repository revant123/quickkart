import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

export type Role = 'customer' | 'admin';

// Lets TypeScript know that req.user may exist after requireAuth runs.
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: Role };
    }
  }
}

/** 401 unless the request carries a valid session cookie. Sets req.user. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.session;
  if (!token) throw new HttpError(401, 'unauthenticated');
  try {
    // verify() checks the signature: an edited token (e.g. role changed to admin) fails here
    const payload = jwt.verify(token, config.JWT_SECRET) as { sub: string; role: Role };
    req.user = { id: Number(payload.sub), role: payload.role };
  } catch {
    throw new HttpError(401, 'invalid_session');
  }
  next();
};

/** 403 unless the logged-in user has the given role. Use after requireAuth. */
export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (req.user?.role !== role) throw new HttpError(403, 'forbidden');
    next();
  };
