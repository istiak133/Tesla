import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp, resetDatabase } from './helpers/test-app.js';

describe('GET /zones (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the 14 Dhaka zones', async () => {
    const response = await request(app.getHttpServer()).get('/zones');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(14);
    expect(response.body).toContainEqual(
      expect.objectContaining({ code: 'BAN', name: 'Banani' }),
    );
  });
});
