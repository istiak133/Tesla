import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  DRIVER_GONE_MS,
  DRIVER_SILENT_MS,
} from '../src/rides/driver-presence.js';
import { DEMO_PASSWORD } from '../src/seed/seed-data.js';
import {
  createDriver,
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// A driver whose app goes silent mid-trip (phone dead, app closed). There is no GPS, so
// presence is any driver request or an open live stream. A silent trip gets no new riders,
// its riders can cancel for free, and after DRIVER_GONE_MS a rider on board may end the ride.
describe('A driver who goes silent (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await seedStoryCast(app);
    [BAN, MOH, GL1] = await Promise.all(
      ['BAN', 'MOH', 'GL1'].map((code) => zoneId(app, code)),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const trip = (pickupZoneId: string, dropoffZoneId: string) => ({
    pickupZoneId,
    dropoffZoneId,
    seats: 1,
  });

  /** Jashim at Banani with Nusrat seated (Banani → Gulshan 1). */
  async function jashimWithNusrat() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const ride = await nusrat.post('/rides').send(trip(BAN, GL1));
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);
    return { jashim, nusrat, rideId: ride.body.id as string };
  }

  /** Makes Jashim's app look silent for `ms`. */
  async function jashimSilentFor(ms: number) {
    await prisma.vehicle.updateMany({
      where: { driver: { email: 'jashim@teslapool.test' } },
      data: { lastSeenAt: new Date(Date.now() - ms) },
    });
  }

  it('every driver request and an open live stream mark the driver as seen', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const seenAt = async () =>
      (
        await prisma.vehicle.findFirstOrThrow({
          where: { driver: { email: 'jashim@teslapool.test' } },
        })
      ).lastSeenAt;

    await jashimSilentFor(10 * 60_000);
    await jashim.get('/driver/pool').expect(200);
    expect(Date.now() - (await seenAt())!.getTime()).toBeLessThan(5_000);

    await jashimSilentFor(10 * 60_000);
    // A stream opened with Jashim's cookie (fetch, so it can be aborted while still open).
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        role: 'DRIVER',
        email: 'jashim@teslapool.test',
        password: DEMO_PASSWORD,
      })
      .expect(200);
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0].split(';')[0];
    const { port } = app.getHttpServer().address() as AddressInfo;
    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/events/stream`, {
      headers: { cookie },
      signal: abort.signal,
    });
    try {
      expect(response.status).toBe(200);
      await expect
        .poll(async () => Date.now() - (await seenAt())!.getTime(), {
          timeout: 3_000,
        })
        .toBeLessThan(5_000);
    } finally {
      abort.abort();
    }
  });

  it("a silent driver's trip gets no new riders; idle drivers see the request instead", async () => {
    await jashimWithNusrat();
    await createDriver(app, {
      name: 'Kamal',
      email: 'kamal@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const kamal = await loginAs(app, 'kamal@teslapool.test');
    await kamal.post('/driver/online').expect(200);
    await jashimSilentFor(DRIVER_SILENT_MS + 1_000);

    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const ride = await rafiq.post('/rides').send(trip(BAN, MOH));

    // Jashim's trip has room and fits, but his app is silent: the round leaves it alone.
    expect((await runMatcher(app)).seated).toBe(0);
    const list = await kamal.get('/driver/requests').expect(200);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([ride.body.id]);
    await kamal.post(`/driver/requests/${ride.body.id}/accept`).expect(200);
    expect((await kamal.get('/driver/pool')).body.pool.seatsTaken).toBe(1);
  });

  it('a late cancel is free when the driver is silent', async () => {
    const { nusrat, rideId } = await jashimWithNusrat();
    // The car is at her stop and the grace period is over: normally Tk 20.
    await prisma.poolMember.updateMany({
      where: { rideRequestId: rideId },
      data: { joinedAt: new Date(Date.now() - 5 * 60_000) },
    });
    const before = await nusrat.get('/rides/current').expect(200);
    expect(before.body.ride).toMatchObject({
      cancelNowFeePaisa: 2000,
      driverSilent: false,
    });

    await jashimSilentFor(DRIVER_SILENT_MS + 1_000);
    const now = await nusrat.get('/rides/current').expect(200);
    expect(now.body.ride).toMatchObject({
      cancelNowFeePaisa: 0,
      driverSilent: true,
      canEndRide: false,
    });
    const cancelled = await nusrat.post(`/rides/${rideId}/cancel`).expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 0,
    });
  });

  it('a rider on board can end the ride once the driver has been gone long enough', async () => {
    const { jashim, nusrat, rideId } = await jashimWithNusrat();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(`/driver/pool/passengers/${rideId}/pickup`).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);

    // On board and the driver is still there: no.
    const refused = await nusrat.post(`/rides/${rideId}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe(
      'A ride cannot be cancelled after pickup',
    );

    // Silent, but not gone yet: still no.
    await jashimSilentFor(DRIVER_SILENT_MS + 1_000);
    expect((await nusrat.post(`/rides/${rideId}/cancel`)).status).toBe(409);

    await jashimSilentFor(DRIVER_GONE_MS + 1_000);
    expect((await nusrat.get('/rides/current')).body.ride).toMatchObject({
      status: 'STARTED',
      driverSilent: true,
      canEndRide: true,
    });
    const ended = await nusrat.post(`/rides/${rideId}/cancel`).expect(200);
    expect(ended.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 0,
    });
    expect(ended.body.history.at(-1).reason).toBe(
      'Passenger ended the ride: the driver stopped responding',
    );

    // The trip is closed (nobody left in it) and she can ask for a new ride.
    expect((await prisma.pool.findFirstOrThrow()).status).toBe('COMPLETED');
    await nusrat.post('/rides').send(trip(MOH, GL1)).expect(201);
  });
});
