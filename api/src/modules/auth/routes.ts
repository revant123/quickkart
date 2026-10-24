import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { pool, withTransaction, type Queryable } from '../../db.js';
import { config } from '../../config.js';
import { enqueue } from '../../notifications/outbox.js';
import { consumeToken, issueToken } from './tokens.js';
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

/** Queues the "confirm your email" message (in the caller's transaction). */
async function sendVerification(db: Queryable, user: { id: string; email: string; name: string }) {
  const token = await issueToken(db, user.id, 'verify_email');
  await enqueue(db, 'email', user.email, 'verify_email', {
    name: user.name,
    link: `${config.APP_URL}/verify-email?token=${token}`,
  });
}

// POST /api/auth/register  -> 201 + user, or 409 if the email is taken
// Also queues the "confirm your email" message, in the same transaction.
authRouter.post('/register', async (req, res) => {
  const body = Register.parse(req.body);
  const hash = await argon2.hash(body.password); // Argon2id, random salt, stored inside the hash
  try {
    const row = await withTransaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
         RETURNING ${PUBLIC_USER}, token_version`,
        [body.email, hash, body.name],
      );
      await sendVerification(db, rows[0]);
      return rows[0];
    });
    const { token_version, ...user } = row;
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

// ===========================================================================
// Email verification
// ===========================================================================

const TokenBody = z.object({ token: z.string().min(20).max(100) });

// POST /api/auth/verify-email { token } -> 200 + user | 400 invalid_or_expired_token
// No login needed: the link may be opened on another device.
authRouter.post('/verify-email', async (req, res) => {
  const { token } = TokenBody.parse(req.body);
  const user = await withTransaction(async (db) => {
    const userId = await consumeToken(db, token, 'verify_email');
    if (!userId) throw new HttpError(400, 'invalid_or_expired_token');
    const { rows } = await db.query(
      `UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1
       RETURNING ${PUBLIC_USER}`,
      [userId],
    );
    return rows[0];
  });
  res.json(user);
});

// POST /api/auth/resend-verification -> 202 | 409 already_verified
authRouter.post('/resend-verification', requireAuth, async (req, res) => {
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      'SELECT id, email, name, email_verified_at FROM users WHERE id = $1 FOR UPDATE',
      [req.user!.id],
    );
    if (rows[0].email_verified_at) throw new HttpError(409, 'already_verified');
    await sendVerification(db, rows[0]);
  });
  res.status(202).json({ ok: true });
});

// ===========================================================================
// Password reset
// ===========================================================================

// POST /api/auth/forgot-password { email } -> ALWAYS 202, whether or not the account
// exists, so this form can't be used to find out who has an account.
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = Register.pick({ email: true }).parse(req.body);
  await withTransaction(async (db) => {
    const { rows } = await db.query('SELECT id, email, name FROM users WHERE email = $1', [email]);
    if (!rows[0]) return;
    const token = await issueToken(db, rows[0].id, 'reset_password');
    await enqueue(db, 'email', rows[0].email, 'reset_password', {
      name: rows[0].name,
      link: `${config.APP_URL}/reset-password?token=${token}`,
    });
  });
  res.status(202).json({ ok: true });
});

// POST /api/auth/reset-password { token, password } -> 204 | 400 invalid_or_expired_token
// Bumps token_version: every existing session (maybe the attacker's) is logged out.
// Opening the link also proves the email works, so it counts as verified.
authRouter.post('/reset-password', async (req, res) => {
  const body = TokenBody.extend({ password: Register.shape.password }).parse(req.body);
  const hash = await argon2.hash(body.password);
  await withTransaction(async (db) => {
    const userId = await consumeToken(db, body.token, 'reset_password');
    if (!userId) throw new HttpError(400, 'invalid_or_expired_token');
    await db.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1,
              email_verified_at = coalesce(email_verified_at, now())
        WHERE id = $1`,
      [userId, hash],
    );
  });
  res.clearCookie('session');
  res.status(204).end();
});
