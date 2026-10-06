import type { NestExpressApplication } from '@nestjs/platform-express';
import { firstValueFrom, take, toArray } from 'rxjs';
import { PrismaService } from '../src/database/prisma.service.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { MatcherService } from '../src/rides/matcher.service.js';
import { RidesRepository } from '../src/rides/rides.repository.js';
import {
  createDriver,
  createPassengers,
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// Batch matching (D-023): every few seconds, all waiting requests are placed in the running
// trips together, decided as one plan, and each seat is still taken under the car's lock.
describe('Batch matching (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let UTT: string, BAN: string, MOH: string, GL1: string, BSH: string;
  const ROUNDS = 5;
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
    [UTT, BAN, MOH, GL1, BSH] = await Promise.all(
      ['UTT', 'BAN', 'MOH', 'GL1', 'BSH'].map((code) => zoneId(app, code)),
    );
  }

  const trip = (pickupZoneId: string, dropoffZoneId: string, seats = 1) => ({
    pickupZoneId,
    dropoffZoneId,
    seats,
  });

  const statusOf = async (rideId: string) =>
    (await prisma.rideRequest.findUniqueOrThrow({ where: { id: rideId } }))
      .status;

  const driverOf = async (rideId: string) => {
    const seat = await prisma.poolMember.findFirst({
      where: { rideRequestId: rideId, leftAt: null },
      include: {
        pool: { include: { vehicle: { include: { driver: true } } } },
      },
    });
    return seat?.pool.vehicle.driver.name ?? null;
  };

  /**
   * Two running trips on Uttara → Bashundhara, each with one rider and two free seats:
   * Jashim's at Banani, Rahim's at Uttara.
   */
  async function twoRunningTrips() {
    await createDriver(app, {
      name: 'Rahim',
      email: 'rahim@teslapool.test',
      zoneCode: 'UTT',
      routeCode: 'UTT-BSH',
    });
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const rahim = await loginAs(app, 'rahim@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    await rahim.post('/driver/online').expect(200);

    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const a = await nusrat.post('/rides').send(trip(BAN, GL1));
    await jashim.post(`/driver/requests/${a.body.id}/accept`).expect(200);
    // Uttara is behind Jashim, so this one is offered to Rahim, idle at Uttara.
    const b = await rafiq.post('/rides').send(trip(UTT, MOH));
    await rahim.post(`/driver/requests/${b.body.id}/accept`).expect(200);
    return { jashim, rahim };
  }

  it('places the riders together, so the one only one car can take is not left behind', async () => {
    await twoRunningTrips();
    const [e1, e2, e3, e4] = await createPassengers(app, 4);
    const [p1, p2, p3, p4] = await Promise.all(
      [e1, e2, e3, e4].map((email) => loginAs(app, email)),
    );
    // R4 needs 2 seats from Uttara: only Rahim's car is still before Uttara.
    const r1 = await p1.post('/rides').send(trip(BAN, MOH));
    const r2 = await p2.post('/rides').send(trip(BAN, GL1));
    const r3 = await p3.post('/rides').send(trip(MOH, BSH));
    const r4 = await p4.post('/rides').send(trip(UTT, BAN, 2));

    const round = await runMatcher(app);

    // One rider at a time (the old rule) would put R1 and R2 in Jashim's car, then R3 in
    // Rahim's (his only free car), leaving R4 short a seat: 3 seats. Together: 4.
    expect(round).toMatchObject({ skipped: false, seated: 3, optimal: true });
    expect(await driverOf(r1.body.id)).toBe('Jashim');
    expect(await driverOf(r2.body.id)).toBe('Jashim');
    expect(await driverOf(r4.body.id)).toBe('Rahim');
    expect(await statusOf(r3.body.id)).toBe('REQUESTED');
    const seats = await prisma.pool.findMany();
    expect(seats.map((p) => p.seatsTaken).sort()).toEqual([3, 3]);
  });

  it('a ride cancelled after the plan was made is skipped; the rest of the plan stands', async () => {
    await twoRunningTrips();
    const [e1, e2] = await createPassengers(app, 2);
    const [p1, p2] = await Promise.all([e1, e2].map((e) => loginAs(app, e)));
    const r1 = await p1.post('/rides').send(trip(BAN, MOH));
    const r2 = await p2.post('/rides').send(trip(BAN, GL1));

    const matcher = app.get(MatcherService);
    const plan = await matcher.plan();
    expect(plan.trips.flatMap((t) => t.requestIds).sort()).toEqual(
      [r1.body.id, r2.body.id].sort(),
    );

    // Between the plan and its seats, R1 cancels.
    await p1.post(`/rides/${r1.body.id}/cancel`).expect(200);
    const applied = await matcher.apply(plan);

    expect(applied).toEqual({ seated: 1, missed: 1 });
    expect(await statusOf(r1.body.id)).toBe('CANCELLED');
    expect(await statusOf(r2.body.id)).toBe('MATCHED');
    expect(await driverOf(r1.body.id)).toBeNull();
  });

  it('a car that left the pickup after the plan was made does not get that rider', async () => {
    const { jashim } = await twoRunningTrips();
    // R1 waits at Banani, where Jashim's car stands: the plan puts R1 in Jashim's car.
    const [e1] = await createPassengers(app, 1);
    const p1 = await loginAs(app, e1);
    const r1 = await p1.post('/rides').send(trip(BAN, MOH));

    const matcher = app.get(MatcherService);
    const plan = await matcher.plan();
    const jashimTrip = plan.trips.find((t) =>
      t.requestIds.includes(r1.body.id),
    );
    expect(jashimTrip).toBeDefined();

    // Meanwhile Jashim's car reaches Banani, picks Nusrat up and leaves it behind.
    const nusratSeat = await prisma.poolMember.findFirstOrThrow({
      where: {
        pool: { vehicle: { driver: { name: 'Jashim' } } },
        leftAt: null,
      },
    });
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim
      .post(`/driver/pool/passengers/${nusratSeat.rideRequestId}/pickup`)
      .expect(200);
    await jashim.post('/driver/pool/depart').expect(200);

    // The stale plan is applied: Banani is now behind Jashim, so the seat is refused
    // under the lock and R1 keeps waiting for the next round.
    const applied = await matcher.apply({ ...plan, trips: [jashimTrip!] });
    expect(applied).toEqual({ seated: 0, missed: 1 });
    expect(await statusOf(r1.body.id)).toBe('REQUESTED');
    expect(await driverOf(r1.body.id)).toBeNull();
  });

  it('an unexpected error on one trip does not cost the rest of the round', async () => {
    await twoRunningTrips();
    const [e1, e2, e3] = await createPassengers(app, 3);
    const [p1, p2, p4] = await Promise.all(
      [e1, e2, e3].map((email) => loginAs(app, email)),
    );
    await p1.post('/rides').send(trip(BAN, MOH));
    await p2.post('/rides').send(trip(BAN, GL1));
    const r4 = await p4.post('/rides').send(trip(UTT, BAN, 2));

    // The plan has two trips. The first car's lock fails as a dropped connection would.
    const repository = app.get(RidesRepository);
    const real = repository.withVehicleLock.bind(repository);
    let calls = 0;
    const spy = vi
      .spyOn(repository, 'withVehicleLock')
      .mockImplementation((vehicleId, work) => {
        calls++;
        if (calls === 1) {
          return Promise.reject(
            new Error('Connection terminated unexpectedly'),
          );
        }
        return real(vehicleId, work);
      });
    try {
      const round = await runMatcher(app);
      expect(round.skipped).toBe(false);
      expect(round.seated).toBeGreaterThan(0);
      expect(round.missed).toBeGreaterThan(0);
      expect(round.seated + round.missed).toBe(3);
    } finally {
      spy.mockRestore();
    }
    // The next round seats whoever the failed trip left waiting.
    await runMatcher(app);
    expect(await statusOf(r4.body.id)).toBe('MATCHED');
  });

  it('every database connection has a statement timeout', async () => {
    const rows = await prisma.$queryRaw<
      { statement_timeout: string }[]
    >`SHOW statement_timeout`;
    expect(rows[0].statement_timeout).toBe('10s');
  });

  it('two rounds never run at once in one instance', async () => {
    await twoRunningTrips();
    const [e1] = await createPassengers(app, 1);
    const p1 = await loginAs(app, e1);
    await p1.post('/rides').send(trip(BAN, MOH));

    const rounds = await Promise.all([runMatcher(app), runMatcher(app)]);
    expect(rounds.map((r) => r.skipped).sort()).toEqual([false, true]);
    expect(rounds.reduce((sum, r) => sum + r.seated, 0)).toBe(1);
  });

  it(
    'race: an idle driver taps a request at the instant the matcher seats it in a running trip',
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await fresh();
        await twoRunningTrips();
        // Kamal is idle at Banani: a stale screen still lets him try to accept.
        await createDriver(app, {
          name: 'Kamal',
          email: 'kamal@teslapool.test',
          zoneCode: 'BAN',
          routeCode: 'UTT-BSH',
        });
        const kamal = await loginAs(app, 'kamal@teslapool.test');
        await kamal.post('/driver/online').expect(200);
        const [e1] = await createPassengers(app, 1);
        const p1 = await loginAs(app, e1);
        const r1 = await p1.post('/rides').send(trip(BAN, MOH));

        const [, accepted] = await Promise.all([
          runMatcher(app),
          kamal.post(`/driver/requests/${r1.body.id}/accept`),
        ]);

        // A running trip can carry R1, so she belongs to the matcher: Kamal's tap is refused
        // whichever comes first (D-023). Exactly one seat, in Jashim's car, and no empty trip
        // is left behind for Kamal.
        const seats = await prisma.poolMember.count({
          where: { rideRequestId: r1.body.id, leftAt: null },
        });
        expect(seats).toBe(1);
        expect(await statusOf(r1.body.id)).toBe('MATCHED');
        expect(await driverOf(r1.body.id)).toBe('Jashim');
        expect(accepted.status).toBe(409);
        expect([
          'A Tesla already on the way is taking this rider',
          'Another driver took this request',
        ]).toContain(accepted.body.message);
        expect((await kamal.get('/driver/pool')).body.pool).toBeNull();
      }
    },
    RACE_TIMEOUT_MS,
  );

  /** `count` riders waiting since long ago from Bashundhara to Uttara, a way no car drives now. */
  async function oldRequestsNobodyCarries(emails: string[]) {
    const riders = await prisma.user.findMany({
      where: { email: { in: emails } },
    });
    await prisma.rideRequest.createMany({
      data: riders.map((rider, i) => ({
        passengerId: rider.id,
        pickupZoneId: BSH,
        dropoffZoneId: UTT,
        seats: 1,
        distanceKm: 15,
        estimatedFarePaisa: 25_500,
        createdAt: new Date(Date.now() - (120 - i) * 60_000),
      })),
    });
  }

  it('50 old requests no running trip can carry do not hide a newer one that fits', async () => {
    await twoRunningTrips();
    const emails = await createPassengers(app, 51);
    await oldRequestsNobodyCarries(emails.slice(0, 50));
    const late = await loginAs(app, emails[50]);
    const ride = await late.post('/rides').send(trip(BAN, MOH));
    expect(ride.body.status).toBe('REQUESTED');

    // The round reads only requests a running trip can carry, so the 50 older ones (going
    // the other way) do not fill its window of 50.
    expect((await runMatcher(app)).seated).toBe(1);
    expect(await driverOf(ride.body.id)).toBe('Jashim');
  });

  it("50 old requests an idle car cannot carry do not hide a newer one from its driver's list", async () => {
    await createDriver(app, {
      name: 'Kamal',
      email: 'kamal@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const kamal = await loginAs(app, 'kamal@teslapool.test');
    await kamal.post('/driver/online').expect(200);
    const emails = await createPassengers(app, 51);
    await oldRequestsNobodyCarries(emails.slice(0, 50));
    const late = await loginAs(app, emails[50]);
    const ride = await late.post('/rides').send(trip(BAN, MOH));

    const list = await kamal.get('/driver/requests').expect(200);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([ride.body.id]);
  });

  it("an idle driver's stale tap cannot start a second car for a rider a running trip can carry", async () => {
    await twoRunningTrips();
    await createDriver(app, {
      name: 'Kamal',
      email: 'kamal@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const kamal = await loginAs(app, 'kamal@teslapool.test');
    await kamal.post('/driver/online').expect(200);
    const [e1] = await createPassengers(app, 1);
    const p1 = await loginAs(app, e1);
    const r1 = await p1.post('/rides').send(trip(BAN, MOH));

    // Hidden from Kamal's list, but a stale screen could still send the accept.
    expect((await kamal.get('/driver/requests')).body).toEqual([]);
    const tap = await kamal.post(`/driver/requests/${r1.body.id}/accept`);
    expect(tap.status).toBe(409);
    expect(tap.body).toMatchObject({
      code: 'ALREADY_TAKEN',
      message: 'A Tesla already on the way is taking this rider',
    });
    expect((await kamal.get('/driver/pool')).body.pool).toBeNull();
    expect(await statusOf(r1.body.id)).toBe('REQUESTED');

    // The round seats her in Jashim's trip.
    expect((await runMatcher(app)).seated).toBe(1);
    expect(await driverOf(r1.body.id)).toBe('Jashim');
  });

  it('tells open screens when a round seats someone, and stays quiet when it seats nobody', async () => {
    await twoRunningTrips();
    const realtime = app.get(RealtimeService);
    const heard: string[][] = [];
    const subscription = realtime.stream.subscribe((topics) =>
      heard.push(topics),
    );
    try {
      expect((await runMatcher(app)).seated).toBe(0);
      expect(heard).toEqual([]);

      const [e1] = await createPassengers(app, 1);
      const p1 = await loginAs(app, e1);
      // The ride request itself publishes too (an HTTP write); wait for the round's hint.
      await p1.post('/rides').send(trip(BAN, MOH));
      heard.length = 0;
      const next = firstValueFrom(realtime.stream.pipe(take(1), toArray()));
      expect((await runMatcher(app)).seated).toBe(1);
      expect(await next).toEqual([['requests', 'rides']]);
    } finally {
      subscription.unsubscribe();
    }
  });
});
