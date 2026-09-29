import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './helpers/test-app.js';

// Runs against the real database from DATABASE_URL.
describe('GET /health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with the database up', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });
});
