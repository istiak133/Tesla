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

// Matching by where the car is (D-014): a new trip starts at the car, auto-join takes the
// nearest car, and the driver's list shows how far each pickup is.
describe('Matching by the car’s position (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let UTT: string,
    BAN: string,
    MOH: string,
    GL1: string,
    BSH: string,
    M10: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await seedStoryCast(app);
    [UTT, BAN, MOH, GL1, BSH, M10] = await Promise.all(
      ['UTT', 'BAN', 'MOH', 'GL1', 'BSH', 'M10'].map((c) => zoneId(app, c)),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const routeId = async (code: string) =>
    (await prisma.route.findUniqueOrThrow({ where: { code } })).id;

  it('A: a new trip starts where the car is, and the car drives to the pickup', async () => {
    // Jashim is at Banani on Uttara → Bashundhara (seed); Nusrat waits at Mohakhali.
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });

    const list = await jashim.get('/driver/requests');
    expect(list.body[0]).toMatchObject({ canAccept: true, pickupKmAhead: 3 });

    const accepted = await jashim.post(
      `/driver/requests/${ride.body.id}/accept`,
    );
    expect(accepted.body.pool.currentStop).toBe(1); // Banani, not Mohakhali
    const waiting = await nusrat.get('/rides/current');
    expect(waiting.body.ride).toMatchObject({
      status: 'MATCHED',
      route: { carStop: 1, pickupStop: 2 }, // one stop away
    });

    // Banani: nobody here, the car moves on; Mohakhali: Nusrat gets in.
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    expect((await nusrat.get('/rides/current')).body.ride.status).toBe(
      'DRIVER_ARRIVED',
    );
    await jashim
      .post(`/driver/pool/passengers/${ride.body.id}/pickup`)
      .expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim
      .post(`/driver/pool/passengers/${ride.body.id}/dropoff`)
      .expect(200);

    // The empty drive Banani → Mohakhali is not paid: 3 km carried + 1 pickup.
    const trip = (await jashim.get('/driver/trips')).body[0];
    expect(trip).toMatchObject({
      collectedPaisa: 7500,
      driverEarningsPaisa: 5000,
      platformFeePaisa: 2500,
    });
  });

  it('A: a pickup behind the car is refused, so the car never drives back empty', async () => {
    // Jashim finished at Bashundhara, the end of his route; Rafiq waits at Uttara.
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    await jashim.post('/driver/location').send({ zoneId: BSH }).expect(200);
    await jashim.post('/driver/online').expect(200);
    const ride = await rafiq
      .post('/rides')
      .send({ pickupZoneId: UTT, dropoffZoneId: BAN, seats: 1 });

    const list = await jashim.get('/driver/requests');
    expect(list.body[0]).toMatchObject({
      canAccept: false,
      pickupKmAhead: null,
      reason: 'Behind your car (Uttara)',
    });
    const accept = await jashim.post(`/driver/requests/${ride.body.id}/accept`);
    expect(accept.status).toBe(409);
    expect(accept.body.code).toBe('NOT_COMPATIBLE');
  });

  it('A: the route must pass the car, and a car off its route cannot start a trip', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });

    // Jashim says he is at Mirpur 10, which his route Uttara → Bashundhara does not pass.
    await jashim.post('/driver/offline').expect(200);
    await jashim.post('/driver/location').send({ zoneId: M10 }).expect(200);
    await jashim.post('/driver/online').expect(200);
    expect((await jashim.get('/driver/requests')).body[0]).toMatchObject({
      canAccept: false,
      reason: 'Your car is not on this route: set your location first',
    });

    // Choosing a route that does not pass Mirpur 10 is refused; one that does is fine.
    await jashim.post('/driver/offline').expect(200);
    const wrong = await jashim
      .post('/driver/route')
      .send({ routeId: await routeId('BAN-DHN') });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('NOT_COMPATIBLE');
    const right = await jashim
      .post('/driver/route')
      .send({ routeId: await routeId('UTT-DHN') });
    expect(right.body.vehicle.route.name).toBe('Uttara → Dhanmondi');
  });

  it('B: auto-join takes the nearest car, not the oldest trip', async () => {
    // Two cars on Uttara → Bashundhara, both already on a trip:
    // Rahim's trip stands at Banani, Jashim's older trip is still at Uttara, 12 km before it.
    await createDriver(app, {
      name: 'Rahim',
      email: 'rahim@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const rahim = await loginAs(app, 'rahim@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');

    await rahim.post('/driver/online').expect(200);
    const s = await shirin
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    await rahim.post(`/driver/requests/${s.body.id}/accept`).expect(200);

    await jashim.post('/driver/location').send({ zoneId: UTT }).expect(200);
    await jashim.post('/driver/online').expect(200);
    const r = await rafiq
      .post('/rides')
      .send({ pickupZoneId: UTT, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${r.body.id}/accept`).expect(200);
    // Make Jashim's trip the older one: the old rule ("oldest trip first") would pick it.
    const jashimPool = await prisma.pool.findFirstOrThrow({
      where: { vehicle: { driver: { email: 'jashim@teslapool.test' } } },
    });
    await prisma.pool.update({
      where: { id: jashimPool.id },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });

    // Nusrat asks at Banani: Rahim is there (0 km), Jashim is 12 km away.
    const n = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(n.body.driver.name).toBe('Rahim');
    expect(n.body.route.carStop).toBe(1);
  });

  it('C: the driver’s list puts takeable, nearby pickups first', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    // Oldest first: Rafiq (Mohakhali, 3 km ahead), Shirin (Uttara, behind), Nusrat (Banani, here).
    await rafiq
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    await shirin
      .post('/rides')
      .send({ pickupZoneId: UTT, dropoffZoneId: BAN, seats: 1 });
    await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post('/driver/online').expect(200);

    const list = (await jashim.get('/driver/requests')).body;
    expect(
      list.map((q: { passengerName: string; pickupKmAhead: number | null }) => [
        q.passengerName,
        q.pickupKmAhead,
      ]),
    ).toEqual([
      ['Nusrat', 0],
      ['Rafiq', 3],
      ['Shirin', null],
    ]);
  });
});
