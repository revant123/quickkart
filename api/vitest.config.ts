import { defineConfig } from 'vitest/config';

// Tests run against the separate db-test database (port 5433):
//   docker compose --profile test up -d db-test
const TEST_ENV = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://quickkart:quickkart@localhost:5433/quickkart_test',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  NODE_ENV: 'test',
  REQUIRE_VERIFIED_EMAIL: 'false', // tests that need it turn it on themselves
  RAZORPAY_KEY_ID: '',
  RAZORPAY_KEY_SECRET: '',
  SMTP_URL: '',
};
// Also set here so global-setup (which migrates the test database) sees them
Object.assign(process.env, TEST_ENV);

export default defineConfig({
  test: {
    env: TEST_ENV,
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false, // test files share one database, so run them one at a time
  },
});
