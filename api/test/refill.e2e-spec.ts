import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import { MATCH_REASON } from '../src/rides/matcher.service.js';
import {
  applyInParallel,
  createDriver,
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  waitedAtStop,
  zoneId,
} from './helpers/test-app.js';

// A freed seat goes to a waiting rider who fits (D-017): after a cancel, a no-show or a
// drop-off, the next match round seats them (D-023), checked again under the car's lock.
describe('Freed seats are filled automatically (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string, GL2: string, BSH: string;
  const ROUNDS = 5;
  // Each race runs ROUNDS fresh databases and logins: more than vitest's 5 s default.
  const RACE_TIMEOUT_MS = 60_000;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await fresh();
  });

  afterAll(async () => {
    await app.close();
  });

  async function fresh() {
    await resetDatabase(app);
    await seedStoryCast(app);
    [BAN, MOH, GL1, GL2, BSH] = await Promise.all(
      ['BAN', 'MOH', 'GL1', 'GL2', 'BSH'].map((code) => zoneId(app, code)),
    );
  }

  const trip = (pickupZoneId: string, dropoffZoneId: string, seats = 1) => ({
    pickupZoneId,
    dropoffZoneId,
    seats,
  });
  const cancel = (rideId: string) => `/rides/${rideId}/cancel`;
  const passenger = (rideId: string, action: string) =>
    `/driver/pool/passengers/${rideId}/${action}`;

  /** Bullet full at Banani: Nusrat 2 seats to Mohakhali, Rafiq 1 to Gulshan 1. */
  async function bulletFull() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const nusratRide = await nusrat.post('/rides').send(trip(BAN, MOH, 2));
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);
    const rafiqRide = await rafiq.post('/rides').send(trip(BAN, GL1));
    await runMatcher(app);
    expect(await statusOf(rafiqRide.body.id)).toBe('MATCHED');
    expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(3);
    return {
      jashim,
      nusrat,
      rafiq,
      shirin,
      nusratRideId: nusratRide.body.id as string,
      rafiqRideId: rafiqRide.body.id as string,
    };
  }

  const statusOf = async (rideId: string) =>
    (await prisma.rideRequest.findUniqueOrThrow({ where: { id: rideId } }))
      .status;

  /** Every pool's seat counter equals the seats of the riders still in it. */
  async function expectSeatsConsistent() {
    const pools = await prisma.pool.findMany({ include: { members: true } });
    for (const pool of pools) {
      const held = pool.members
        .filter((member) => member.leftAt === null)
        .reduce((sum, member) => sum + member.seats, 0);
      expect(pool.seatsTaken).toBe(held);
      expect(pool.seatsTaken).toBeLessThanOrEqual(pool.seatCapacity);
    }
  }

  it('a cancel frees a seat and a waiting rider who fits gets it at once', async () => {
    const { jashim, rafiq, shirin, rafiqRideId } = await bulletFull();
    await shirin.post('/rides').send(trip(MOH, BSH));
    expect((await runMatcher(app)).seated).toBe(0); // Bullet is full

    await rafiq.post(cancel(rafiqRideId)).expect(200);
    expect((await runMatcher(app)).seated).toBe(1);

    const shirinNow = (await shirin.get('/rides/current')).body.ride;
    expect(shirinNow.status).toBe('MATCHED');
    expect(shirinNow.coRiders).toEqual(['Nusrat']);
    expect(shirinNow.history.at(-1).reason).toBe(MATCH_REASON);
    expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(3);
    await expectSeatsConsistent();
  });

  it('a no-show frees a seat for a waiting rider too', async () => {
    const { jashim, shirin, rafiqRideId } = await bulletFull();
    const shirinRide = await shirin.post('/rides').send(trip(GL1, GL2));
    await jashim.post('/driver/pool/arrive').expect(200);
    await waitedAtStop(app);

    await jashim.post(passenger(rafiqRideId, 'no-show')).expect(200);
    await runMatcher(app);

    expect(await statusOf(shirinRide.body.id)).toBe('MATCHED');
    await expectSeatsConsistent();
  });

  it('never takes a rider behind the car or going the other way', async () => {
    const { jashim, shirin, nusratRideId, rafiqRideId } = await bulletFull();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(passenger(nusratRideId, 'pickup')).expect(200);
    await jashim.post(passenger(rafiqRideId, 'pickup')).expect(200);
    await jashim.post('/driver/pool/depart').expect(200); // Banani is now behind

    const behind = await shirin.post('/rides').send(trip(BAN, GL1));
    await jashim.post('/driver/pool/arrive').expect(200); // Mohakhali
    await jashim.post(passenger(nusratRideId, 'dropoff')).expect(200);
    expect((await runMatcher(app)).seated).toBe(0);

    expect(await statusOf(behind.body.id)).toBe('REQUESTED');
    expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(1);
  });

  it('with one seat free, a rider waiting 5+ minutes goes first, then the nearest pickup', async () => {
    const { rafiq, shirin, rafiqRideId } = await bulletFull();
    // Shirin waits at Gulshan 2 (far), a new rider at Mohakhali (near).
    const far = await shirin.post('/rides').send(trip(GL2, BSH));
    await createPassenger('Mitu', 'mitu@teslapool.test');
    const mitu = await loginAs(app, 'mitu@teslapool.test');
    const near = await mitu.post('/rides').send(trip(MOH, GL1));

    // Nearest first when nobody has waited long.
    await rafiq.post(cancel(rafiqRideId)).expect(200);
    await runMatcher(app);
    expect(await statusOf(near.body.id)).toBe('MATCHED');
    expect(await statusOf(far.body.id)).toBe('REQUESTED');

    // Now make Shirin's request 6 minutes old and free Mitu's seat: aging puts her first.
    await prisma.rideRequest.update({
      where: { id: far.body.id },
      data: { createdAt: new Date(Date.now() - 6 * 60_000) },
    });
    const rafiqAgain = await rafiq.post('/rides').send(trip(MOH, GL1));
    expect((await runMatcher(app)).seated).toBe(0); // full again
    await mitu.post(cancel(near.body.id)).expect(200);
    await runMatcher(app);
    expect(await statusOf(far.body.id)).toBe('MATCHED');
    expect(await statusOf(rafiqAgain.body.id)).toBe('REQUESTED');
    await expectSeatsConsistent();
  });

  it(
    'race: two matchers seat the same rider in two cars at once; she ends in exactly one',
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await fresh();
        const { rafiq, rafiqRideId, shirin } = await bulletFull();
        // Rahim's car, also full at Banani on the same route: Mitu 2 seats, Lima 1.
        await createDriver(app, {
          name: 'Rahim',
          email: 'rahim@teslapool.test',
          zoneCode: 'BAN',
          routeCode: 'UTT-BSH',
        });
        const rahim = await loginAs(app, 'rahim@teslapool.test');
        await rahim.post('/driver/online').expect(200);
        await createPassenger('Mitu', 'mitu@teslapool.test');
        await createPassenger('Lima', 'lima@teslapool.test');
        const mitu = await loginAs(app, 'mitu@teslapool.test');
        const lima = await loginAs(app, 'lima@teslapool.test');
        const mituRide = await mitu.post('/rides').send(trip(BAN, GL1, 2));
        await rahim
          .post(`/driver/requests/${mituRide.body.id}/accept`)
          .expect(200);
        const limaRide = await lima.post('/rides').send(trip(BAN, GL1));
        await runMatcher(app); // Bullet is full, so Lima goes to Rahim's car
        expect(await statusOf(limaRide.body.id)).toBe('MATCHED');

        // Shirin waits at Mohakhali; both cars are full.
        const shirinRide = await shirin.post('/rides').send(trip(MOH, BSH));
        expect((await runMatcher(app)).seated).toBe(0);

        // One seat frees in each car at the same moment; both trips keep running.
        await Promise.all([
          rafiq.post(cancel(rafiqRideId)),
          lima.post(cancel(limaRide.body.id)),
        ]);

        // Two matchers, one for each car, both seat Shirin at the same instant.
        const trips = await prisma.pool.findMany({
          where: { status: { in: ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'] } },
        });
        expect(trips).toHaveLength(2);
        await applyInParallel(
          app,
          trips.map((t) => ({
            vehicleId: t.vehicleId,
            poolId: t.id,
            rideId: shirinRide.body.id as string,
          })),
        );

        const seats = await prisma.poolMember.count({
          where: { rideRequestId: shirinRide.body.id, leftAt: null },
        });
        expect(seats).toBe(1);
        expect(await statusOf(shirinRide.body.id)).toBe('MATCHED');
        await expectSeatsConsistent();
      }
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'race: the waiting rider cancels while the matcher seats her: she ends cancelled, seats right',
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await fresh();
        const { rafiq, rafiqRideId, shirin } = await bulletFull();
        const shirinRide = await shirin.post('/rides').send(trip(MOH, BSH));

        await rafiq.post(cancel(rafiqRideId)).expect(200);

        // Her cancel and the round that seats her, at the same moment.
        const [shirinCancel] = await Promise.all([
          shirin.post(cancel(shirinRide.body.id)),
          runMatcher(app),
        ]);
        expect(shirinCancel.status).toBe(200);
        expect(await statusOf(shirinRide.body.id)).toBe('CANCELLED');
        await expectSeatsConsistent();
      }
    },
    RACE_TIMEOUT_MS,
  );

  /** One more passenger account (same demo password as the story cast). */
  async function createPassenger(name: string, email: string) {
    const nusrat = await prisma.user.findUniqueOrThrow({
      where: { email: 'nusrat@teslapool.test' },
    });
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: nusrat.passwordHash,
        role: 'PASSENGER',
      },
    });
  }
});
