import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp, resetDatabase } from './helpers/test-app.js';

describe('GET /zones and GET /routes (e2e)', () => {
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

  it('lists the six routes with their stops in driving order', async () => {
    const response = await request(app.getHttpServer()).get('/routes');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(6);
    const route = response.body.find(
      (r: { code: string }) => r.code === 'UTT-BSH',
    );
    expect(route.name).toBe('Uttara → Bashundhara');
    expect(
      route.stops.map((stop: { zone: { code: string } }) => stop.zone.code),
    ).toEqual(['UTT', 'BAN', 'MOH', 'GL1', 'GL2', 'BSH']);
  });

  it('lists where a passenger can ride from a pickup', async () => {
    const server = request(app.getHttpServer());
    const zones = (await server.get('/zones')).body as {
      id: string;
      code: string;
    }[];
    const idOf = (code: string) => zones.find((z) => z.code === code)!.id;

    const fromBanani = await server.get(`/zones/${idOf('BAN')}/destinations`);
    expect(fromBanani.status).toBe(200);
    const codes = fromBanani.body.map((zone: { code: string }) => zone.code);
    expect(codes).toEqual(expect.arrayContaining(['MOH', 'GL1', 'DHN']));

    // Uttara → Bashundhara exists on a route but goes too far round.
    const fromUttara = await server.get(`/zones/${idOf('UTT')}/destinations`);
    expect(
      fromUttara.body.map((zone: { code: string }) => zone.code),
    ).not.toContain('BSH');
  });
});
