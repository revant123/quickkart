import { z } from 'zod';

// All configuration comes from environment variables (12-factor style).
// If anything is missing or wrong, the server refuses to start and says why.
const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  REDIS_URL: z.string().optional(), // used on Day 6
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const config = Env.parse(process.env);
