import type { RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

export type Role = 'customer' | 'admin' | 'rider';

export type SessionUser = { id: number; role: Role; storeId: number | null; emailVerified: boolean };

// Lets TypeScript know that req.user may exist after requireAuth runs.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Signs a JWT holding the user id and token version, and sets it as an httpOnly cookie. */
export function setSession(res: Response, user: { id: string | number; token_version: number }) {
  const token = jwt.sign({ sub: String(user.id), ver: user.token_version }, config.JWT_SECRET, {
    expiresIn: '7d',
  });
  res.cookie('session', token, {
    httpOnly: true, // XSS can't steal it
    sameSite: 'lax', // other sites' forms can't send it with cross-site POSTs (CSRF defence)
    secure: config.COOKIE_SECURE, // HTTPS only, once deployed with HTTPS
    maxAge: SEVEN_DAYS_MS,
  });
}

/**
 * 401 unless the request carries a valid session. Sets req.user.
 *
 * The signature check proves the token was issued by us. Then ONE primary-key
 * lookup loads the user's CURRENT role and token version:
 *  - a role change (customer -> admin) applies on the next request, no re-login
 *  - bumping token_version (password reset, "log out everywhere") kills old tokens
 * That fixes the usual weakness of JWTs: they can't otherwise be revoked early.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.session;
  if (!token) throw new HttpError(401, 'unauthenticated');

  let payload: { sub: string; ver?: number };
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as { sub: string; ver?: number };
  } catch {
    throw new HttpError(401, 'invalid_session');
  }

  const { rows } = await pool.query(
    'SELECT id, role, token_version, store_id, email_verified_at FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || (payload.ver ?? 0) !== user.token_version) throw new HttpError(401, 'invalid_session');

  req.user = {
    id: Number(user.id),
    role: user.role,
    storeId: user.store_id === null ? null : Number(user.store_id),
    emailVerified: user.email_verified_at !== null,
  };
  next();
};

/** 403 unless the logged-in user has one of the given roles. Use after requireAuth. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw new HttpError(403, 'forbidden');
    next();
  };
