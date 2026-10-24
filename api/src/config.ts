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
  APP_URL: z.string().url().default('http://localhost:5173'),
  // Customers must verify their email before ordering (off in tests and load tests)
  REQUIRE_VERIFIED_EMAIL: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Email: an SMTP server (Mailpit locally, Resend when deployed). Empty = print to the log.
  SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
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
});

export const config = Env.parse(process.env);
