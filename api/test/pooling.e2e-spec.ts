import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  applyInParallel,
  createPassengers,
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// The PRD's must-have tests (§12) for requesting, pooling and cancelling,
// plus the en-route rules: joining a Tesla that is already on its way.
describe('Ride requests and pooling (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string, UTT: string, BSH: string;
  // Race tests run several fresh databases each: more than the default per-test limit.
  const RACE_TIMEOUT_MS = 60_000;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await seedStoryCast(app);
    BAN = await zoneId(app, 'BAN');
    MOH = await zoneId(app, 'MOH');
    GL1 = await zoneId(app, 'GL1');
    UTT = await zoneId(app, 'UTT');
    BSH = await zoneId(app, 'BSH');
  });

  afterAll(async () => {
    await app.close();
  });

  async function jashimOnline() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    return jashim;
  }

  it('Nusrat and Rafiq share Bullet: accept, then automatic join', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');

    // No pool yet: Nusrat waits, with the solo estimate of ৳75.
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(nusratRide.status).toBe(201);
    expect(nusratRide.body.status).toBe('REQUESTED');
    expect(nusratRide.body.estimatedFarePaisa).toBe(7500);

    // Jashim accepts: a trip starts on his route, heading to Banani.
    const accepted = await jashim.post(
      `/driver/requests/${nusratRide.body.id}/accept`,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.pool.seatsTaken).toBe(1);

    // Rafiq (Banani → Gulshan 1) is on the same route ahead. His request waits for the
    // next match round (D-023), which seats him in Bullet without anyone accepting.
    const rafiqRequest = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(rafiqRequest.body.status).toBe('REQUESTED');
    expect((await runMatcher(app)).seated).toBe(1);

    const rafiqRide = (await rafiq.get('/rides/current')).body.ride;
    expect(rafiqRide.status).toBe('MATCHED');
    expect(rafiqRide.driver).toEqual({
      name: 'Jashim',
      vehicleName: 'Bullet',
    });
    expect(rafiqRide.coRiders).toEqual(['Nusrat']);
    expect(rafiqRide.route).toMatchObject({
      name: 'Uttara → Bashundhara',
      pickupStop: 1, // Banani
      dropoffStop: 3, // Gulshan 1
      carStop: 1,
      carAtStop: false,
    });

    const pool = await jashim.get('/driver/pool');
    expect(pool.body.pool.seatsTaken).toBe(2);
    expect(pool.body.pool.passengers).toHaveLength(2);
  });

  it('does not pool a trip going the other way on the route', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');

    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);

    // Bullet drives Uttara → Bashundhara; Banani → Uttara is the opposite direction.
    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: UTT, seats: 1 });
    expect(shirinRide.body.status).toBe('REQUESTED');

    // Not listed for Bullet (D-020); accepting it anyway is refused with the reason.
    expect((await jashim.get('/driver/requests')).body).toEqual([]);
    const accept = await jashim.post(
      `/driver/requests/${shirinRide.body.id}/accept`,
    );
    expect(accept.body).toMatchObject({
      code: 'NOT_COMPATIBLE',
      message: 'Not on this route in this direction',
    });
  });

  it("Bullet's capacity is never exceeded when many riders race for the last seat", async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');

    // Nusrat takes 2 of Bullet's 3 seats, so exactly one seat is left.
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 2 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);

    // Twenty riders ask for that last seat at the same moment.
    const emails = await createPassengers(app, 20);
    const agents = await Promise.all(
      emails.map((email) => loginAs(app, email)),
    );
    const responses = await Promise.all(
      agents.map((agent) =>
        agent
          .post('/rides')
          .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 }),
      ),
    );

    // Every request is stored and waits for a seat.
    expect(responses.every((r) => r.body.status === 'REQUESTED')).toBe(true);

    // The hardest form of the race: twenty matchers at once, each sure the last seat is
    // its rider's, all through the real write path (D-023).
    const bullet = await prisma.pool.findFirstOrThrow();
    await applyInParallel(
      app,
      responses.map((r) => ({
        vehicleId: bullet.vehicleId,
        poolId: bullet.id,
        rideId: r.body.id as string,
      })),
    );
    // A normal round afterwards finds no seat left and changes nothing.
    expect((await runMatcher(app)).seated).toBe(0);

    const ids = responses.map((r) => r.body.id as string);
    const matched = await prisma.rideRequest.count({
      where: { id: { in: ids }, status: 'MATCHED' },
    });
    const waiting = await prisma.rideRequest.count({
      where: { id: { in: ids }, status: 'REQUESTED' },
    });
    expect(matched).toBe(1); // exactly one winner
    expect(waiting).toBe(19); // nobody dropped: the rest keep waiting

    const pool = await prisma.pool.findFirstOrThrow();
    expect(pool.seatsTaken).toBe(3);
    // The seat counter always equals the seats of the active members.
    const members = await prisma.poolMember.findMany({
      where: { poolId: pool.id, leftAt: null },
    });
    expect(members.reduce((sum, m) => sum + m.seats, 0)).toBe(pool.seatsTaken);
  });

  it('the PRD case: Nusrat and Shirin claim Bullet’s last seat at the same instant', async () => {
    // Rafiq takes 2 of Bullet's 3 seats, so exactly one seat is left at Banani.
    for (let round = 0; round < 5; round++) {
      await resetDatabase(app);
      await seedStoryCast(app);
      BAN = await zoneId(app, 'BAN');
      MOH = await zoneId(app, 'MOH');
      GL1 = await zoneId(app, 'GL1');
      const jashim = await jashimOnline();
      const rafiq = await loginAs(app, 'rafiq@teslapool.test');
      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      const shirin = await loginAs(app, 'shirin@teslapool.test');
      const rafiqRide = await rafiq
        .post('/rides')
        .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 2 });
      await jashim
        .post(`/driver/requests/${rafiqRide.body.id}/accept`)
        .expect(200);

      // Both see one free seat and ask at the same moment.
      const [nusratRide, shirinRide] = await Promise.all([
        nusrat
          .post('/rides')
          .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 }),
        shirin
          .post('/rides')
          .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 }),
      ]);

      // Both requests are stored; neither has a seat yet.
      expect([nusratRide.body.status, shirinRide.body.status]).toEqual([
        'REQUESTED',
        'REQUESTED',
      ]);

      // Two matchers claim the last seat at the same instant, one for each of them.
      const bullet = await prisma.pool.findFirstOrThrow();
      await applyInParallel(app, [
        {
          vehicleId: bullet.vehicleId,
          poolId: bullet.id,
          rideId: nusratRide.body.id,
        },
        {
          vehicleId: bullet.vehicleId,
          poolId: bullet.id,
          rideId: shirinRide.body.id,
        },
      ]);
      expect((await runMatcher(app)).seated).toBe(0);

      // Exactly one gets the seat; the other keeps waiting and is not lost.
      const statuses = await Promise.all(
        [nusrat, shirin].map(
          async (agent) => (await agent.get('/rides/current')).body.ride.status,
        ),
      );
      expect(statuses.sort()).toEqual(['MATCHED', 'REQUESTED']);
      const pool = await prisma.pool.findFirstOrThrow();
      expect(pool.seatsTaken).toBe(3);
      // The one who lost keeps waiting (still REQUESTED); Bullet is full, so it is not
      // in Jashim's list any more, and another car can take it (D-020).
      expect((await jashim.get('/driver/requests')).body).toEqual([]);
      expect(
        await prisma.rideRequest.count({ where: { status: 'REQUESTED' } }),
      ).toBe(1);
    }
  });

  it('two accepts at the same moment create one pool, not two', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');

    const a = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    const b = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });

    await Promise.all([
      jashim.post(`/driver/requests/${a.body.id}/accept`),
      jashim.post(`/driver/requests/${b.body.id}/accept`),
    ]);

    const pools = await prisma.pool.findMany();
    expect(pools).toHaveLength(1);
    expect(pools[0].seatsTaken).toBe(2);
  });

  it('refuses a trip that no Tesla route serves', async () => {
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const M10 = await zoneId(app, 'M10');

    const response = await nusrat
      .post('/rides')
      .send({ pickupZoneId: GL1, dropoffZoneId: M10, seats: 1 });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('NO_ROUTE');

    // A route that exists but goes too far round is not sold either:
    // Uttara → Bashundhara on Airport Road is 24 km for a 9 km trip.
    const farRound = await nusrat
      .post('/rides')
      .send({ pickupZoneId: UTT, dropoffZoneId: BSH, seats: 1 });
    expect(farRound.status).toBe(400);
    expect(farRound.body.code).toBe('NO_ROUTE');
  });

  /** Nusrat (Banani → Mohakhali) picked up; Bullet has left Banani for Mohakhali. */
  async function bulletOnTheWay() {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim
      .post(`/driver/pool/passengers/${ride.body.id}/pickup`)
      .expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    return { jashim, nusrat, nusratRideId: ride.body.id as string };
  }

  it('a passenger at a stop ahead joins a Tesla that is already on its way', async () => {
    await bulletOnTheWay();
    const shirin = await loginAs(app, 'shirin@teslapool.test');

    const request = await shirin
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: BSH, seats: 1 });
    expect(request.body.status).toBe('REQUESTED');
    await runMatcher(app);

    const ride = (await shirin.get('/rides/current')).body.ride;
    expect(ride.status).toBe('MATCHED');
    expect(ride.coRiders).toEqual(['Nusrat']);
    expect(ride.route).toMatchObject({ carStop: 2, pickupStop: 2 });
  });

  it('a stop the Tesla has already passed is refused', async () => {
    const { jashim } = await bulletOnTheWay();
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');

    const ride = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(ride.body.status).toBe('REQUESTED');
    // The match round does not seat him either: Bullet is past his stop.
    expect((await runMatcher(app)).seated).toBe(0);

    // Not listed for Bullet (D-020); accepting it anyway is refused with the reason.
    expect((await jashim.get('/driver/requests')).body).toEqual([]);
    const accept = await jashim.post(`/driver/requests/${ride.body.id}/accept`);
    expect(accept.status).toBe(409);
    expect(accept.body).toMatchObject({
      code: 'NOT_COMPATIBLE',
      message: 'The car has already passed Banani',
    });
  });

  it(
    'leaving a stop and a passenger being seated at that stop never overlap',
    async () => {
      // Rounds, so both orders of the race get a chance to happen.
      for (let round = 0; round < 3; round++) {
        await resetDatabase(app);
        await seedStoryCast(app);
        BAN = await zoneId(app, 'BAN');
        MOH = await zoneId(app, 'MOH');
        GL1 = await zoneId(app, 'GL1');
        const jashim = await jashimOnline();
        const rafiq = await loginAs(app, 'rafiq@teslapool.test');
        const shirin = await loginAs(app, 'shirin@teslapool.test');

        // Rafiq (Banani → Gulshan 1) is on board and Bullet is standing at Mohakhali.
        const rafiqRide = await rafiq
          .post('/rides')
          .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
        await jashim
          .post(`/driver/requests/${rafiqRide.body.id}/accept`)
          .expect(200);
        await jashim.post('/driver/pool/arrive').expect(200);
        await jashim
          .post(`/driver/pool/passengers/${rafiqRide.body.id}/pickup`)
          .expect(200);
        await jashim.post('/driver/pool/depart').expect(200);
        await jashim.post('/driver/pool/arrive').expect(200);

        // Shirin waits at Mohakhali. At the same moment the matcher seats her and
        // Jashim presses "leave for Gulshan 1".
        await shirin
          .post('/rides')
          .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 })
          .expect(201);
        const [, depart] = await Promise.all([
          runMatcher(app),
          jashim.post('/driver/pool/depart'),
        ]);
        const shirinNow = (await shirin.get('/rides/current')).body.ride;

        // Exactly one wins. Either she was seated first (the car must wait for her), or
        // the car left first (Mohakhali is behind it now and she keeps waiting).
        const shirinSeated = shirinNow.status === 'DRIVER_ARRIVED';
        const carLeft = depart.status === 200;
        expect(shirinSeated).not.toBe(carLeft);
        if (carLeft) {
          expect(shirinNow.status).toBe('REQUESTED');
        } else {
          expect(depart.body.code).toBe('INVALID_TRANSITION');
        }
      }
    },
    RACE_TIMEOUT_MS,
  );

  it('a seat freed at a drop-off goes straight to a rider waiting there (D-017)', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');

    // Nusrat takes 2 seats to Mohakhali and Rafiq 1 to Gulshan 1: Bullet is full.
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 2 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    await runMatcher(app);
    expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
      'MATCHED',
    );

    // Shirin waits at Mohakhali: Bullet is full, so a round does not seat her yet.
    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: BSH, seats: 1 });
    expect(shirinRide.body.status).toBe('REQUESTED');
    expect((await runMatcher(app)).seated).toBe(0);

    // Bullet drives to Mohakhali and Nusrat gets off: two seats are free again.
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim
      .post(`/driver/pool/passengers/${nusratRide.body.id}/pickup`)
      .expect(200);
    await jashim
      .post(`/driver/pool/passengers/${rafiqRide.body.id}/pickup`)
      .expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    const dropped = await jashim.post(
      `/driver/pool/passengers/${nusratRide.body.id}/dropoff`,
    );
    // Two seats came free. The next round gives Shirin, standing right there, one of
    // them without anyone accepting (D-017, D-023).
    expect(dropped.body.pool.seatsTaken).toBe(1);
    expect((await runMatcher(app)).seated).toBe(1);
    const shirinNow = await shirin.get('/rides/current');
    expect(shirinNow.body.ride.status).toBe('DRIVER_ARRIVED');
    expect(shirinNow.body.ride.coRiders).toEqual(['Rafiq']);
  });

  it('a driver must choose a route before going online, and keeps it during a trip', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await prisma.vehicle.updateMany({ data: { routeId: null } });

    const online = await jashim.post('/driver/online');
    expect(online.status).toBe(409);
    expect(online.body.code).toBe('ROUTE_REQUIRED');

    const utt = await prisma.route.findUniqueOrThrow({
      where: { code: 'UTT-BSH' },
    });
    const chosen = await jashim.post('/driver/route').send({ routeId: utt.id });
    expect(chosen.status).toBe(200);
    expect(chosen.body.vehicle.route.name).toBe('Uttara → Bashundhara');
    await jashim.post('/driver/online').expect(200);

    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);

    const other = await prisma.route.findUniqueOrThrow({
      where: { code: 'BAN-DHN' },
    });
    const change = await jashim
      .post('/driver/route')
      .send({ routeId: other.id });
    expect(change.status).toBe(409);
    expect(change.body.code).toBe('HAS_ACTIVE_POOL');
  });

  it('the database itself refuses more seats than the capacity', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);

    // Bypass the application completely: the CHECK constraint still holds.
    await expect(
      prisma.$executeRaw`UPDATE pools SET seats_taken = 4`,
    ).rejects.toThrow();
    // Nor can a passenger get off before (or where) they got on.
    await expect(
      prisma.$executeRaw`UPDATE pool_members SET dropoff_stop = pickup_stop`,
    ).rejects.toThrow();
  });

  it("users can't see or cancel another user's ride", async () => {
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });

    const read = await rafiq.get(`/rides/${ride.body.id}`);
    expect(read.status).toBe(403);

    const cancel = await rafiq.post(`/rides/${ride.body.id}/cancel`);
    expect(cancel.status).toBe(403);
    expect(cancel.body.code).toBe('NOT_YOUR_RIDE');
  });

  it('passengers and drivers cannot use each other’s endpoints', async () => {
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const jashim = await loginAs(app, 'jashim@teslapool.test');

    expect((await nusrat.get('/driver/requests')).status).toBe(403);
    expect((await jashim.get('/rides/current')).status).toBe(403);
  });

  it('allows only one active ride per passenger', async () => {
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 })
      .expect(201);

    const second = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ACTIVE_RIDE_EXISTS');
  });

  it('cancelling frees the seat, and an empty pool is closed', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);

    const cancelled = await nusrat.post(`/rides/${ride.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const pool = await prisma.pool.findFirstOrThrow();
    expect(pool.seatsTaken).toBe(0);
    expect(pool.status).toBe('CANCELLED');

    // Jashim is free again and can go offline.
    expect((await jashim.post('/driver/offline')).status).toBe(200);
  });

  it('a driver cannot go offline during a trip or accept while offline', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);

    const offline = await jashim.post('/driver/offline');
    expect(offline.status).toBe(409);
    expect(offline.body.code).toBe('HAS_ACTIVE_POOL');

    // A different driver state: offline driver cannot accept.
    await nusrat.post(`/rides/${ride.body.id}/cancel`).expect(200);
    await jashim.post('/driver/offline').expect(200);
    const waiting = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    const accept = await jashim.post(
      `/driver/requests/${waiting.body.id}/accept`,
    );
    expect(accept.status).toBe(409);
    expect(accept.body.code).toBe('DRIVER_OFFLINE');
  });

  it('records every status change in the ride history', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);
    await nusrat.post(`/rides/${ride.body.id}/cancel`).expect(200);

    const details = await nusrat.get(`/rides/${ride.body.id}`);
    expect(
      details.body.history.map((h: { status: string }) => h.status),
    ).toEqual(['REQUESTED', 'MATCHED', 'CANCELLED']);
  });
});
