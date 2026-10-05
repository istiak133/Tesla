import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// Passenger cancel (D-016): when it is allowed, what it frees, and every race around it.
describe('Passenger cancel (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string;
  const ROUNDS = 5;
  // Each race runs ROUNDS fresh databases and logins: more than vitest's 5 s default.
  const RACE_TIMEOUT_MS = 30_000;

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
    [BAN, MOH, GL1] = await Promise.all(
      ['BAN', 'MOH', 'GL1'].map((code) => zoneId(app, code)),
    );
  }

  /** Jashim online at Banani; Nusrat waiting there for Mohakhali (no trip yet). */
  async function nusratWaiting() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(ride.body.status).toBe('REQUESTED');
    return { jashim, nusrat, rideId: ride.body.id as string };
  }

  /** The same, with Nusrat in Jashim's trip and Rafiq sharing it. */
  async function nusratMatched() {
    const setup = await nusratWaiting();
    await setup.jashim
      .post(`/driver/requests/${setup.rideId}/accept`)
      .expect(200);
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    await runMatcher(app); // he fits Jashim's running trip (D-023)
    expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
      'MATCHED',
    );
    return { ...setup, rafiq, rafiqRideId: rafiqRide.body.id as string };
  }

  const cancel = (rideId: string) => `/rides/${rideId}/cancel`;
  const passenger = (rideId: string, action: string) =>
    `/driver/pool/passengers/${rideId}/${action}`;

  /** Every pool's seat counter equals the seats of the riders still in it. */
  async function expectSeatsConsistent() {
    const pools = await prisma.pool.findMany({ include: { members: true } });
    for (const pool of pools) {
      const held = pool.members
        .filter((member) => member.leftAt === null)
        .reduce((sum, member) => sum + member.seats, 0);
      expect(pool.seatsTaken).toBe(held);
    }
  }

  const cancelledEvents = (rideId: string) =>
    prisma.rideEvent.count({
      where: { rideRequestId: rideId, toStatus: 'CANCELLED' },
    });

  describe('when a passenger can cancel', () => {
    it('while waiting for a driver', async () => {
      const { nusrat, rideId } = await nusratWaiting();
      expect((await nusrat.post(cancel(rideId))).body.status).toBe('CANCELLED');
    });

    it('while the car is on its way: her seat is freed at once', async () => {
      const { jashim, nusrat, rideId } = await nusratMatched();
      expect((await nusrat.post(cancel(rideId))).status).toBe(200);
      expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(1);
      await expectSeatsConsistent();
    });

    it('while the car waits at her stop', async () => {
      const { jashim, nusrat, rideId } = await nusratMatched();
      await jashim.post('/driver/pool/arrive').expect(200);
      expect((await nusrat.post(cancel(rideId))).body.status).toBe('CANCELLED');
      // The driver can leave now: nobody is left to pick up here except Rafiq.
      await expectSeatsConsistent();
    });

    it('not once she is in the car, and not after the ride is finished', async () => {
      const { jashim, nusrat, rideId, rafiqRideId } = await nusratMatched();
      await jashim.post('/driver/pool/arrive').expect(200);
      await jashim.post(passenger(rideId, 'pickup')).expect(200);
      const inCar = await nusrat.post(cancel(rideId));
      expect(inCar.status).toBe(409);
      expect(inCar.body.message).toBe(
        'A ride cannot be cancelled after pickup',
      );

      await jashim.post(passenger(rafiqRideId, 'pickup')).expect(200);
      await jashim.post('/driver/pool/depart').expect(200);
      await jashim.post('/driver/pool/arrive').expect(200);
      await jashim.post(passenger(rideId, 'dropoff')).expect(200);
      const done = await nusrat.post(cancel(rideId));
      expect(done.status).toBe(409);
      expect(done.body.message).toBe('This ride is already finished');
      expect((await nusrat.get(`/rides/${rideId}`)).body.status).toBe(
        'COMPLETED',
      );
    });

    it('the last passenger cancelling closes an empty trip; the driver can start a new one', async () => {
      const { jashim, nusrat, rideId } = await nusratWaiting();
      await jashim.post(`/driver/requests/${rideId}/accept`).expect(200);
      await nusrat.post(cancel(rideId)).expect(200);

      expect((await jashim.get('/driver/pool')).body.pool).toBeNull();
      const pool = await prisma.pool.findFirstOrThrow();
      expect(pool.status).toBe('CANCELLED'); // nobody was carried: no money split
      expect(pool.collectedPaisa).toBeNull();

      // She can ask again at once: the one-active-ride rule no longer holds her.
      const again = await nusrat
        .post('/rides')
        .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
      expect(again.status).toBe(201);
    });
  });

  describe('races around a cancel', () => {
    it(
      'two cancels at once (a double tap or a retry) both get the cancelled ride',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          await fresh();
          const { nusrat, rideId, jashim } = await nusratMatched();

          const [first, second] = await Promise.all([
            nusrat.post(cancel(rideId)),
            nusrat.post(cancel(rideId)),
          ]);
          expect([first.status, second.status]).toEqual([200, 200]);
          expect(first.body.status).toBe('CANCELLED');
          expect(second.body.status).toBe('CANCELLED');
          expect(await cancelledEvents(rideId)).toBe(1); // cancelled once
          expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(
            1,
          );
          await expectSeatsConsistent();
        }
        // And a later retry, one by one, too.
        await fresh();
        const { nusrat, rideId } = await nusratWaiting();
        await nusrat.post(cancel(rideId)).expect(200);
        expect((await nusrat.post(cancel(rideId))).body.status).toBe(
          'CANCELLED',
        );
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'a cancel and a driver accept at the same instant: one wins, nothing half made',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          await fresh();
          const { jashim, nusrat, rideId } = await nusratWaiting();

          const [cancelled, accepted] = await Promise.all([
            nusrat.post(cancel(rideId)),
            jashim.post(`/driver/requests/${rideId}/accept`),
          ]);
          // The passenger always gets what she asked for.
          expect(cancelled.status).toBe(200);
          expect(cancelled.body.status).toBe('CANCELLED');
          // The driver either got there first (and the seat was then given back)
          // or is told plainly that she cancelled.
          if (accepted.status !== 200) {
            expect(accepted.status).toBe(409);
            expect(accepted.body.message).toBe(
              'The passenger cancelled this request',
            );
          }
          // No empty trip is left running for Jashim.
          expect((await jashim.get('/driver/pool')).body.pool).toBeNull();
          expect(await cancelledEvents(rideId)).toBe(1);
          await expectSeatsConsistent();
        }
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'a cancel and the pickup at the same instant: exactly one happens',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          await fresh();
          const { jashim, nusrat, rideId } = await nusratMatched();
          await jashim.post('/driver/pool/arrive').expect(200);

          const [cancelled, pickedUp] = await Promise.all([
            nusrat.post(cancel(rideId)),
            jashim.post(passenger(rideId, 'pickup')),
          ]);
          const status = (await nusrat.get(`/rides/${rideId}`)).body.status;
          if (cancelled.status === 200) {
            expect(status).toBe('CANCELLED');
            expect(pickedUp.status).toBe(404); // she is no longer in the trip
          } else {
            expect(cancelled.status).toBe(409);
            expect(pickedUp.status).toBe(200);
            expect(status).toBe('STARTED');
          }
          await expectSeatsConsistent();
        }
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'a cancel and a no-show at the same instant: cancelled once, seat freed once',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          await fresh();
          const { jashim, nusrat, rideId } = await nusratMatched();
          await jashim.post('/driver/pool/arrive').expect(200);

          const [cancelled] = await Promise.all([
            nusrat.post(cancel(rideId)),
            jashim.post(passenger(rideId, 'no-show')),
          ]);
          expect(cancelled.status).toBe(200);
          expect(cancelled.body.status).toBe('CANCELLED');
          expect(await cancelledEvents(rideId)).toBe(1);
          // Rafiq still holds his one seat; Nusrat's was given back exactly once.
          expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(
            1,
          );
          await expectSeatsConsistent();
        }
      },
      RACE_TIMEOUT_MS,
    );
  });
});
