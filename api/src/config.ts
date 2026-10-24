import { z } from 'zod';

// All configuration comes from environment variables (12-factor style).
// If anything is missing or wrong, the server refuses to start and says why.
const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Empty or missing = caching off. The app works without Redis; it's only faster with it.
  REDIS_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // Per-IP / per-user request limits (turned off automatically in tests)
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // Apply pending database migrations when the server starts (safe with many instances)
  MIGRATE_ON_START: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Where the website is, for links in emails ("verify your email", "reset password")
  // On Render, RENDER_EXTERNAL_URL (e.g. https://quickkart.onrender.com) is set automatically
  APP_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'),
  // Customers must verify their email before ordering (off in tests and load tests)
  REQUIRE_VERIFIED_EMAIL: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Email: an SMTP server (Mailpit locally, Resend when deployed). Empty = print to the log.
  SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  // Resend's HTTPS API (used instead of SMTP when set: Render's free plan blocks SMTP ports)
  RESEND_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  // Demo mode: deliver EVERY email and SMS to this one inbox, labelled with the real recipient.
  // (Resend only delivers to your own address until you verify a domain.)
  MAIL_REDIRECT_TO: z.string().optional().transform((v) => (v ? v : undefined)),
  MAIL_FROM: z.string().default('QuickKart <orders@quickkart.test>'),
  // SMS have no free test gateway, so they are delivered as emails to <phone>@this domain
  // and show up in the same inbox, labelled as SMS.
  SMS_EMAIL_DOMAIN: z.string().default('sms.quickkart.test'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),

  // Payments. With no Razorpay keys a built-in test gateway is used (same flow, no account).
  RAZORPAY_KEY_ID: z.string().optional().transform((v) => (v ? v : undefined)),
  RAZORPAY_KEY_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
  PAYMENT_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(120).default(15),

  // ---- Deployment (Batch C) ----
  // Folder with the built website. Set in the single-container image: the API serves
  // the site itself, so shop and API share one HTTPS address (no nginx needed).
  STATIC_DIR: z.string().optional().transform((v) => (v ? v : undefined)),
  // Load the sample data on start-up if the database has no stores (fresh deploys)
  SEED_ON_EMPTY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SEED_FILE: z.string().default(new URL('../../db/seed/seed.sql', import.meta.url).pathname),
  // Keep 30-minute delivery slots open for the next 2 days, so a demo never runs out
  AUTO_SLOTS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // How many proxies sit in front of the API (nginx = 1), or "true" to trust the whole
  // X-Forwarded-For chain (needed where the hop count isn't fixed, e.g. Render).
  TRUST_PROXY: z.string().default('1').transform((v) => (v === 'true' ? true : Number(v))),
  // Accounts with these emails are admins (comma-separated). For hosts with no shell,
  // where scripts/make-admin.sh can't run. Applied at start-up and on registration.
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
});

export const config = Env.parse(process.env);
