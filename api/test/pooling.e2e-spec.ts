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

// The PRD's must-have tests (§12) for requesting, pooling and cancelling.
describe('Ride requests and pooling (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string, UTT: string;

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

    // Jashim accepts: a pool is created at Banani.
    const accepted = await jashim.post(
      `/driver/requests/${nusratRide.body.id}/accept`,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.pool.seatsTaken).toBe(1);

    // Rafiq (Banani → Gulshan 1, detour 2 km) joins the open pool at once.
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(rafiqRide.body.status).toBe('MATCHED');
    expect(rafiqRide.body.driver).toEqual({
      name: 'Jashim',
      vehicleName: 'Bullet',
    });
    expect(rafiqRide.body.coRiders).toEqual(['Nusrat']);

    const pool = await jashim.get('/driver/pool');
    expect(pool.body.pool.seatsTaken).toBe(2);
    expect(pool.body.pool.passengers).toHaveLength(2);
  });

  it('does not pool a trip whose detour is longer than 2 km', async () => {
    const jashim = await jashimOnline();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');

    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);

    // Banani → Uttara via Mohakhali is a 4 km detour.
    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: UTT, seats: 1 });
    expect(shirinRide.body.status).toBe('REQUESTED');

    const list = await jashim.get('/driver/requests');
    expect(list.body[0]).toMatchObject({
      canAccept: false,
      reason: 'Detour would be longer than 2 km',
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

    // Eight riders ask for that last seat at the same moment.
    const emails = await createPassengers(app, 8);
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
    expect(waiting).toHaveLength(7); // nobody dropped: the rest keep waiting

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
