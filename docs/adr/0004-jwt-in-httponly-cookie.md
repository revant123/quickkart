# ADR 0004: Sessions as a signed JWT in an httpOnly cookie

**Status:** accepted

## Context
The API must know who is calling and whether they are an admin, and it must stay
stateless so several API containers can run behind nginx.

## Decision
On login the API signs a JWT (`{ sub: userId, role }`, 7-day expiry) and sets it as a
cookie with `httpOnly`, `SameSite=Lax`, and `Secure` when served over HTTPS. Middleware
verifies the signature on each request; `requireRole('admin')` guards admin routes.
Passwords are hashed with Argon2id. Promotion to admin happens only in the database.

## Consequences
- **Good:** no session store; any API container can verify any request.
- **Good:** `httpOnly` means a cross-site scripting bug can't read the token; `SameSite=Lax`
  blocks cross-site form posts from sending it.
- **Good:** the website and API share one origin through nginx (and Vite's proxy in
  development), so no CORS configuration is needed.
- **Cost:** a JWT can't be revoked before it expires; a stolen token or a changed role lasts
  until expiry (the role change needs a fresh login). Fix if needed: a `sessions` table or a
  token version per user checked on each request, or short-lived tokens with refresh.
- **Alternative considered:** server-side sessions in PostgreSQL or Redis. Easy to revoke,
  but adds a lookup on every request and shared state.
