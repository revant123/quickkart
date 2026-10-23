import { defineConfig } from 'vitest/config';

// Tests run against the separate db-test database (port 5433):
//   docker compose --profile test up -d db-test
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://quickkart:quickkart@localhost:5433/quickkart_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      NODE_ENV: 'test',
    },
    fileParallelism: false, // test files share one database, so run them one at a time
  },
});
