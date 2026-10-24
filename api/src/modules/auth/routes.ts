import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { pool } from '../../db.js';
import { HttpError } from '../../errors.js';
import { requireAuth, setSession } from '../../middleware/auth.js';

export const authRouter = Router();

const Register = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
});
const Login = Register.pick({ email: true, password: true });

/** The fields of a user the browser may see (never the password hash). */
export const PUBLIC_USER = `id, email, name, role, store_id, phone,
  email_verified_at IS NOT NULL AS email_verified`;

// POST /api/auth/register  -> 201 + user, or 409 if the email is taken
authRouter.post('/register', async (req, res) => {
  const body = Register.parse(req.body);
  const hash = await argon2.hash(body.password); // Argon2id, random salt, stored inside the hash
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       RETURNING ${PUBLIC_USER}, token_version`,
      [body.email, hash, body.name],
    );
    const { token_version, ...user } = rows[0];
    setSession(res, { id: user.id, token_version });
    res.status(201).json(user);
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'email_taken'); // unique_violation
    throw e;
  }
});

// POST /api/auth/login  -> 200 + user, or 401
authRouter.post('/login', async (req, res) => {
  const body = Login.parse(req.body);
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_USER}, token_version, password_hash FROM users WHERE email = $1`,
    [body.email],
  );
  const found = rows[0];
  // Same answer whether the email or the password is wrong: don't reveal which accounts exist
  if (!found || !(await argon2.verify(found.password_hash, body.password))) {
    throw new HttpError(401, 'invalid_credentials');
  }
  const { password_hash: _hash, token_version, ...user } = found;
  setSession(res, { id: user.id, token_version });
  res.json(user);
});

// POST /api/auth/logout  -> 204 (this browser only)
authRouter.post('/logout', requireAuth, (_req, res) => {
  res.clearCookie('session');
  res.status(204).end();
});

// POST /api/auth/logout-all  -> 204: every session on every device stops working
authRouter.post('/logout-all', requireAuth, async (req, res) => {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user!.id]);
  res.clearCookie('session');
  res.status(204).end();
});

// GET /api/auth/me  -> 200 + current user, or 401
authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_USER} FROM users WHERE id = $1`, [req.user!.id]);
  res.json(rows[0]);
});
