import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server forwards every /api request to the Express API, so the browser
// sees ONE origin: the session cookie just works and there is no CORS to configure.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:4000' },
  },
});
