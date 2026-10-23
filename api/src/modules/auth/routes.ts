import { Router, type Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../../db.js';
import { config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter = Router();

const Register = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
});
const Login = Register.pick({ email: true, password: true });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Signs a JWT and stores it in an httpOnly cookie (page JavaScript can't read it). */
function setSession(res: Response, user: { id: string | number; role: string }) {
  const token = jwt.sign({ sub: String(user.id), role: user.role }, config.JWT_SECRET, {
    expiresIn: '7d',
  });
  res.cookie('session', token, {
    httpOnly: true, // XSS can't steal it
    sameSite: 'lax', // other sites' forms can't send it with cross-site POSTs (CSRF defence)
    secure: config.COOKIE_SECURE, // HTTPS only, once deployed with HTTPS
    maxAge: SEVEN_DAYS_MS,
  });
}

// POST /api/auth/register  -> 201 + user, or 409 if the email is taken
authRouter.post('/register', async (req, res) => {
  const body = Register.parse(req.body);
  const hash = await argon2.hash(body.password); // Argon2id, random salt, stored inside the hash
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       RETURNING id, email, name, role`,
      [body.email, hash, body.name],
    );
    setSession(res, rows[0]);
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'email_taken'); // unique_violation
    throw e;
  }
});

// POST /api/auth/login  -> 200 + user, or 401
authRouter.post('/login', async (req, res) => {
  const body = Login.parse(req.body);
  const { rows } = await pool.query(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
    [body.email],
  );
  const user = rows[0];
  // Same answer whether the email or the password is wrong: don't reveal which accounts exist
  if (!user || !(await argon2.verify(user.password_hash, body.password))) {
    throw new HttpError(401, 'invalid_credentials');
  }
  setSession(res, user);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// POST /api/auth/logout  -> 204
authRouter.post('/logout', requireAuth, (_req, res) => {
  res.clearCookie('session');
  res.status(204).end();
});

// GET /api/auth/me  -> 200 + current user, or 401
authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, name, role FROM users WHERE id = $1', [
    req.user!.id,
  ]);
  if (!rows[0]) throw new HttpError(401, 'invalid_session');
  res.json(rows[0]);
});
