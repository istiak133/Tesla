import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createDriver,
  createTestApp,
  loginAs,
  resetDatabase,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// The driver cancels a trip (before the first pickup) with the later features in place:
// no fee for the riders (D-018), and they are offered again at once, the same way a new
// request is: a running car that fits seats them automatically, otherwise every idle car
// that can take them sees them (D-020, D-021).
describe('Driver cancels a trip (e2e)', () => {
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

  /** Jashim's trip at Banani with Nusrat (→ Mohakhali), who got her seat 10 minutes ago. */
  async function nusratWithJashim() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);
    await jashim.post('/driver/pool/arrive').expect(200); // the car is at her stop
    await prisma.poolMember.updateMany({
      where: { rideRequestId: ride.body.id },
      data: { joinedAt: new Date(Date.now() - 10 * 60_000) },
    });
    return { jashim, nusrat, rideId: ride.body.id as string };
  }

  it('sends the riders back to waiting, with the reason and no late-cancel fee', async () => {
    const { jashim, nusrat, rideId } = await nusratWithJashim();
    await jashim.post('/driver/pool/cancel').expect(200);

    const ride = (await nusrat.get('/rides/current')).body.ride;
    expect(ride).toMatchObject({
      status: 'REQUESTED',
      cancellationFeePaisa: 0,
    });
    expect(ride.history.at(-1).reason).toBe(
      'Driver cancelled the trip; waiting for another driver',
    );
    const stored = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: rideId },
    });
    expect(stored.cancellationFeePaisa).toBe(0);
  });

  it('a running car that can take them seats them at once, like a new request', async () => {
    // Jashim's car is full at Banani: Nusrat 2 seats and Shirin 1, both to Mohakhali.
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 2 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);
    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(shirinRide.body.driver.name).toBe('Jashim');

    // Rahim's trip at Banani has Rafiq and two free seats.
    await createDriver(app, {
      name: 'Rahim',
      email: 'rahim@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const rahim = await loginAs(app, 'rahim@teslapool.test');
    await rahim.post('/driver/online').expect(200);
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    await rahim
      .post(`/driver/requests/${rafiqRide.body.id}/accept`)
      .expect(200);

    // Jashim's car breaks down: Nusrat (2 seats) fits Rahim's car and is seated at once;
    // Shirin no longer fits and waits, shown to idle cars (here Jashim's own, now idle).
    await jashim.post('/driver/pool/cancel').expect(200);
    const nusratNow = (await nusrat.get('/rides/current')).body.ride;
    expect(nusratNow).toMatchObject({ status: 'MATCHED', coRiders: ['Rafiq'] });
    expect(nusratNow.driver.name).toBe('Rahim');
    expect((await shirin.get('/rides/current')).body.ride.status).toBe(
      'REQUESTED',
    );
    expect(
      (await jashim.get('/driver/requests')).body.map(
        (r: { id: string }) => r.id,
      ),
    ).toEqual([shirinRide.body.id]);
  });

  it('with no running car that fits, every idle car that can take them sees them', async () => {
    await createDriver(app, {
      name: 'Rahim',
      email: 'rahim@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const rahim = await loginAs(app, 'rahim@teslapool.test');
    await rahim.post('/driver/online').expect(200);

    const { jashim, rideId } = await nusratWithJashim();
    await jashim.post('/driver/pool/cancel').expect(200);

    const listed = (await rahim.get('/driver/requests')).body.map(
      (r: { id: string }) => r.id,
    );
    expect(listed).toEqual([rideId]);
    // Rahim takes her; the fresh seat has its own grace period again.
    await rahim.post(`/driver/requests/${rideId}/accept`).expect(200);
    const seat = await prisma.poolMember.findFirstOrThrow({
      where: { rideRequestId: rideId, leftAt: null },
    });
    expect(Date.now() - seat.joinedAt.getTime()).toBeLessThan(60_000);
  });

  it('the passenger can still cancel for free while waiting again', async () => {
    const { jashim, nusrat, rideId } = await nusratWithJashim();
    await jashim.post('/driver/pool/cancel').expect(200);
    const cancelled = await nusrat.post(`/rides/${rideId}/cancel`);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 0,
    });
  });
});
