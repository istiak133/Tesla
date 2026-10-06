import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedStoryCast,
} from './helpers/test-app.js';

// Every private route, checked the same way: no session → 401, the other role → 403. The
// guards are set per controller, so this catches a new handler or controller that forgets
// them. When a route is added, add it here.
const ANY_ID = '00000000-0000-4000-8000-000000000000';

const PASSENGER_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['post', '/rides'],
  ['get', '/rides/current'],
  ['get', '/rides'],
  ['get', `/rides/${ANY_ID}`],
  ['post', `/rides/${ANY_ID}/cancel`],
];

const DRIVER_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', '/driver/pool'],
  ['get', '/driver/trips'],
  ['get', '/driver/routes'],
  ['post', '/driver/location'],
  ['post', '/driver/route'],
  ['post', '/driver/online'],
  ['post', '/driver/offline'],
  ['get', '/driver/requests'],
  ['post', `/driver/requests/${ANY_ID}/accept`],
  ['post', '/driver/pool/arrive'],
  ['post', '/driver/pool/depart'],
  ['post', `/driver/pool/passengers/${ANY_ID}/pickup`],
  ['post', `/driver/pool/passengers/${ANY_ID}/dropoff`],
  ['post', `/driver/pool/passengers/${ANY_ID}/no-show`],
  ['post', '/driver/pool/cancel'],
];

const SIGNED_IN_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', '/auth/me'],
  ['post', '/auth/logout'],
];

describe('Access to private routes (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedStoryCast(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([...PASSENGER_ROUTES, ...DRIVER_ROUTES, ...SIGNED_IN_ROUTES])(
    '%s %s needs a session (401)',
    async (method, path) => {
      const response = await request(app.getHttpServer())[method](path);
      expect(response.status).toBe(401);
    },
  );

  it.each(PASSENGER_ROUTES)(
    '%s %s is for passengers only (a driver gets 403)',
    async (method, path) => {
      const jashim = await loginAs(app, 'jashim@teslapool.test');
      expect((await jashim[method](path)).status).toBe(403);
    },
  );

  it.each(DRIVER_ROUTES)(
    '%s %s is for drivers only (a passenger gets 403)',
    async (method, path) => {
      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      expect((await nusrat[method](path)).status).toBe(403);
    },
  );

  it('an expired session is refused everywhere, the live stream too', async () => {
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await nusrat.get('/auth/me').expect(200);
    await app.get(PrismaService).session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect((await nusrat.get('/auth/me')).status).toBe(401);
    expect((await nusrat.get('/rides/current')).status).toBe(401);
    const login = await request(app.getHttpServer()).post('/auth/login').send({
      role: 'PASSENGER',
      email: 'shirin@teslapool.test',
      password: 'tesla1234',
    });
    // A cookie whose session has expired, sent to the stream:
    const { port } = app.getHttpServer().address() as AddressInfo;
    await app.get(PrismaService).session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const stream = await fetch(`http://127.0.0.1:${port}/events/stream`, {
      headers: { cookie },
    });
    expect(stream.status).toBe(401);
  });
});
