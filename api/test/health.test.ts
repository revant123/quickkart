import request from 'supertest';
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';

describe('GET /api/health', () => {
  afterAll(() => pool.end());

  it('returns ok when the database is reachable', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(buildApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
