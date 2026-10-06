import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { seedGeography } from '../src/seed/seed-data.js';
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

  it('seeding again never rewrites the stops of a route that already exists', async () => {
    const prisma = app.get(PrismaService);
    // Running it again on a seeded database changes nothing.
    expect(await seedGeography(prisma)).toEqual({ routesLeftAsTheyAre: [] });

    // The code and the database disagree on a stop (as after an edit to the route list):
    // trips store stop positions, so the seed leaves the route alone and reports it.
    const route = await prisma.route.findUniqueOrThrow({
      where: { code: 'UTT-BSH' },
    });
    await prisma.routeStop.update({
      where: { routeId_position: { routeId: route.id, position: 2 } },
      data: { kmFromStart: { increment: 1 } },
    });
    const before = await prisma.routeStop.findMany({
      where: { routeId: route.id },
      orderBy: { position: 'asc' },
    });
    expect(await seedGeography(prisma)).toEqual({
      routesLeftAsTheyAre: ['UTT-BSH'],
    });
    expect(
      await prisma.routeStop.findMany({
        where: { routeId: route.id },
        orderBy: { position: 'asc' },
      }),
    ).toEqual(before);
    await resetDatabase(app);
  });
});
