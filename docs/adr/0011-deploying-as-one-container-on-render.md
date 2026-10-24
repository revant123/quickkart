# ADR 0011: Deploying as one container on Render's free plan

**Status:** accepted

## Context
QuickKart should be online at a public HTTPS address: for demos, and because Razorpay
webhooks need one. Budget: zero. Locally it runs as five containers (nginx, API,
PostgreSQL, Redis, Mailpit). Render's free plan offers web services, one PostgreSQL and
one Key Value (Redis) instance, with limits: services sleep after 15 minutes idle (about a
minute to wake), no shell, outbound SMTP ports 25/465/587 blocked, and the free database
expires after 30 days.

## Decision
- **One container, one origin.** A root `Dockerfile` builds the website and the API, and
  the API serves the built site (`STATIC_DIR`). No nginx: the shop, the API and the live
  update streams share one HTTPS address, so cookies stay `SameSite` and there's no CORS.
  Hashed assets are cached for a year; `index.html` is never cached, so deploys show at once.
- **Infrastructure as code:** `render.yaml` (a Blueprint) declares the web service, Redis
  and PostgreSQL, wires their connection strings in, generates `JWT_SECRET`, and marks the
  real secrets `sync: false`, so Render asks for them and they never enter Git.
- **No manual setup after deploy:** migrations run on start (ADR 0007); `SEED_ON_EMPTY` loads
  the sample shop into an empty database (advisory lock, one transaction); a job keeps 30-minute
  delivery slots open two days ahead; `ADMIN_EMAILS` makes your account the admin (no shell needed).
- **Email over HTTPS:** Resend's REST API (port 443) instead of SMTP, with the outbox row id
  as an idempotency key. Without a verified domain Resend only delivers to the account
  owner, so `MAIL_REDIRECT_TO` sends every email and SMS to the owner's inbox, labelled with
  the real recipient. Email confirmation is not required on the public demo.
- **Client IPs for rate limits:** the number of proxies in front of a Render service isn't
  documented as fixed, so `TRUST_PROXY=true` takes the first address in `X-Forwarded-For`.
  Trade-off: a client could fake that header to dodge its own limit; the alternative (a wrong
  hop count) could put every visitor behind one proxy IP and lock everyone out together.
- **CI builds and smoke-tests the exact image** on every push: start it against an empty
  PostgreSQL, check the page, the API, deep links and that the sample data appears.

## Consequences
- **Good:** `git push` → tests → deploy, with no hand-edited servers; the image that runs in
  production is the one CI tested.
- **Found by rehearsing the deploy locally:** the rate limiter loaded its Redis scripts before
  Redis had connected, failed, and silently stopped limiting. Script loads now wait for Redis.
- **Cost:** the first visit after 15 idle minutes takes about a minute; background jobs pause
  while asleep (they catch up on wake: expired payments are cancelled then).
- **Cost:** the free database is deleted 30 days after creation unless upgraded. Fine for a
  demo; for real use, a paid plan with backups.
- **Cost:** one instance only on the free plan, so the multi-container features (shared rate
  limits, LISTEN/NOTIFY fan-out, advisory-locked jobs) are exercised locally and in tests, not here.
- **Alternatives considered:** separate static site + API service (two origins, CORS and
  cross-site cookies); a VPS with Docker Compose (more to manage, not free); Vercel/Netlify
  (great for the website, but no long-running API with SSE and background jobs).
