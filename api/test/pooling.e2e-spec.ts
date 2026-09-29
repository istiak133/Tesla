import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createPassengers,
  createTestApp,
  loginAs,
  resetDatabase,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// The PRD's must-have tests (§12) for requesting, pooling and cancelling,
// plus the en-route rules: joining a Tesla that is already on its way.
describe('Ride requests and pooling (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string, UTT: string, BSH: string;

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

    // Rafiq (Banani → Gulshan 1) is on the same route ahead: he joins at once.
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(rafiqRide.body.status).toBe('MATCHED');
    expect(rafiqRide.body.driver).toEqual({
      name: 'Jashim',
      vehicleName: 'Bullet',
    });
    expect(rafiqRide.body.coRiders).toEqual(['Nusrat']);
    expect(rafiqRide.body.route).toMatchObject({
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

    const list = await jashim.get('/driver/requests');
    expect(list.body[0]).toMatchObject({
      canAccept: false,
      reason: 'Not on this route in this direction',
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

    const matched = responses.filter((r) => r.body.status === 'MATCHED');
    const waiting = responses.filter((r) => r.body.status === 'REQUESTED');
    expect(matched).toHaveLength(1); // exactly one winner
    expect(waiting).toHaveLength(19); // nobody dropped: the rest keep waiting

    const pool = await prisma.pool.findFirstOrThrow();
    expect(pool.seatsTaken).toBe(3);
    // The seat counter always equals the seats of the active members.
    const members = await prisma.poolMember.findMany({
      where: { poolId: pool.id, leftAt: null },
    });
    expect(members.reduce((sum, m) => sum + m.seats, 0)).toBe(pool.seatsTaken);
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

    const ride = await shirin
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: BSH, seats: 1 });
    expect(ride.body.status).toBe('MATCHED');
    expect(ride.body.coRiders).toEqual(['Nusrat']);
    expect(ride.body.route).toMatchObject({ carStop: 2, pickupStop: 2 });
  });

  it('a stop the Tesla has already passed is refused', async () => {
    const { jashim } = await bulletOnTheWay();
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');

    const ride = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(ride.body.status).toBe('REQUESTED');

    const list = await jashim.get('/driver/requests');
    expect(list.body[0]).toMatchObject({
      canAccept: false,
      reason: 'The car has already passed Banani',
    });
    const accept = await jashim.post(`/driver/requests/${ride.body.id}/accept`);
    expect(accept.status).toBe(409);
    expect(accept.body.code).toBe('NOT_COMPATIBLE');
  });

  it('leaving a stop and a passenger joining at that stop never overlap', async () => {
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

    // Now, at the same moment: Shirin asks to be picked up at Mohakhali,
    // and Jashim presses "leave for Gulshan 1".
    const [shirinRide, depart] = await Promise.all([
      shirin
        .post('/rides')
        .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 }),
      jashim.post('/driver/pool/depart'),
    ]);

    // Exactly one of them wins. Either Shirin got in first (the car must wait for her),
    // or the car left first (Mohakhali is now behind it and Shirin keeps waiting).
    const shirinJoined = shirinRide.body.status === 'DRIVER_ARRIVED';
    const carLeft = depart.status === 200;
    expect(shirinJoined).not.toBe(carLeft);
    if (carLeft) {
      expect(shirinRide.body.status).toBe('REQUESTED');
    } else {
      expect(depart.body.code).toBe('INVALID_TRANSITION');
    }
  });

  it('a seat freed at a drop-off can be taken further along the route', async () => {
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
    expect(rafiqRide.body.status).toBe('MATCHED');

    // Shirin waits at Mohakhali: no seat yet.
    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: BSH, seats: 1 });
    expect(shirinRide.body.status).toBe('REQUESTED');

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
    expect(dropped.body.pool.seatsTaken).toBe(1);

    // Now Jashim can take Shirin, who is standing right there.
    const list = await jashim.get('/driver/requests');
    expect(list.body[0]).toMatchObject({ canAccept: true });
    const accepted = await jashim.post(
      `/driver/requests/${shirinRide.body.id}/accept`,
    );
    expect(accepted.status).toBe(200);
    const shirinNow = await shirin.get('/rides/current');
    expect(shirinNow.body.ride.status).toBe('DRIVER_ARRIVED');
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
