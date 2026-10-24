import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../../db.js';

// Single-use links for "confirm your email" and "reset your password".
// The link carries a random 256-bit token; the database keeps only its SHA-256
// hash, so someone who reads the database can't use the links. (A fast hash is
// fine here, unlike for passwords: the token is random, not guessable.)

export type Purpose = 'verify_email' | 'reset_password';
export const TOKEN_LIFETIME: Record<Purpose, string> = { verify_email: '24 hours', reset_password: '1 hour' };

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Creates a new token, cancelling any older unused one for the same purpose. */
export async function issueToken(db: Queryable, userId: number | string, purpose: Purpose): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );
  await db.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + $4::interval)`,
    [userId, purpose, hash(token), TOKEN_LIFETIME[purpose]],
  );
  return token;
}

/**
 * Uses up a token: returns its user id, or null if it's unknown, expired or used.
 * ONE conditional UPDATE, so two clicks on the same link can't both succeed.
 */
export async function consumeToken(db: Queryable, token: string, purpose: Purpose): Promise<string | null> {
  const { rows } = await db.query(
    `UPDATE user_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hash(token), purpose],
  );
  return rows[0]?.user_id ?? null;
}
