import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// The system suggests a route from where the car is; the driver still chooses.
describe('Route suggestions and the car’s location (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string, DHN: string, FRM: string;

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
    DHN = await zoneId(app, 'DHN');
    FRM = await zoneId(app, 'FRM');
  });

  afterAll(async () => {
    await app.close();
  });

  it('suggests the route with the most riders waiting ahead of the car', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');

    // Jashim starts at Banani (seed). Two riders go towards Dhanmondi, one to Gulshan 1.
    await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: DHN, seats: 1 });
    await rafiq
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: FRM, seats: 1 });
    await shirin
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });

    const response = await jashim.get('/driver/routes');
    expect(response.status).toBe(200);
    expect(response.body.currentZone.name).toBe('Banani');
    expect(response.body.routes[0]).toMatchObject({
      name: 'Banani → Dhanmondi',
      passesYou: true,
      waitingAhead: 2,
    });
    expect(response.body.suggestedRouteId).toBe(
      response.body.routes[0].routeId,
    );

    // Only a suggestion: Jashim takes it with one tap, or picks another.
    const chosen = await jashim
      .post('/driver/route')
      .send({ routeId: response.body.suggestedRouteId });
    expect(chosen.body.vehicle.route.name).toBe('Banani → Dhanmondi');
  });

  it('lists only the routes that pass where the car is, each with the riders waiting on it', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const [M10, MR2] = await Promise.all([
      zoneId(app, 'M10'),
      zoneId(app, 'MR2'),
    ]);
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: M10, dropoffZoneId: MR2, seats: 1 });
    expect(rafiqRide.body.status).toBe('REQUESTED');

    // At Banani: the two lines through Banani, both ways, and nothing else.
    const atBanani = (await jashim.get('/driver/routes')).body;
    expect(atBanani.routes.map((r: { name: string }) => r.name).sort()).toEqual(
      [
        'Banani → Dhanmondi',
        'Bashundhara → Uttara',
        'Dhanmondi → Banani',
        'Uttara → Bashundhara',
      ],
    );
    expect(
      atBanani.routes.every((r: { passesYou: boolean }) => r.passesYou),
    ).toBe(true);

    // At Mirpur 10: Uttara → Bashundhara no longer passes the car, so it is cleared and
    // Jashim is offline until he picks a route from the list.
    await jashim.post('/driver/online').expect(200);
    const moved = await jashim
      .post('/driver/location')
      .send({ zoneId: M10 })
      .expect(200);
    expect(moved.body.vehicle).toMatchObject({ route: null, isOnline: false });
    // Only the Mirpur line is listed, with Rafiq counted on the way to Dhanmondi.
    const atMirpur = (await jashim.get('/driver/routes')).body;
    expect(atMirpur.routes).toEqual([
      expect.objectContaining({ name: 'Uttara → Dhanmondi', waitingAhead: 1 }),
      expect.objectContaining({ name: 'Dhanmondi → Uttara', waitingAhead: 0 }),
    ]);

    // Moving along a route the driver already drives keeps it.
    const mirpurLine = atMirpur.routes[0].routeId;
    await jashim
      .post('/driver/route')
      .send({ routeId: mirpurLine })
      .expect(200);
    const MR2kept = await jashim
      .post('/driver/location')
      .send({ zoneId: MR2 })
      .expect(200);
    expect(MR2kept.body.vehicle.route.id).toBe(mirpurLine);

    // Location unknown: nothing to choose until the driver sets it.
    await prisma.vehicle.updateMany({ data: { currentZoneId: null } });
    const nowhere = (await jashim.get('/driver/routes')).body;
    expect(nowhere).toMatchObject({ currentZone: null, routes: [] });
  });

  it('the car’s location follows the stops, and cannot be set by hand during a trip', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');

    // Before any trip the driver tells the system where he is.
    const moved = await jashim.post('/driver/location').send({ zoneId: MOH });
    expect(moved.status).toBe(200);
    expect(moved.body.vehicle.currentZone.name).toBe('Mohakhali');

    // Jashim drives Uttara → Bashundhara (seed) and picks Nusrat up at Mohakhali.
    await jashim.post('/driver/online').expect(200);
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);

    const during = await jashim.post('/driver/location').send({ zoneId: BAN });
    expect(during.status).toBe(409);
    expect(during.body.code).toBe('HAS_ACTIVE_POOL');

    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim
      .post(`/driver/pool/passengers/${ride.body.id}/pickup`)
      .expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    const atGulshan = await jashim.post('/driver/pool/arrive');
    expect(atGulshan.body.vehicle.currentZone.name).toBe('Gulshan 1');

    // After the last drop-off, suggestions start from where the car ended up.
    await jashim
      .post(`/driver/pool/passengers/${ride.body.id}/dropoff`)
      .expect(200);
    const vehicle = await prisma.vehicle.findFirstOrThrow();
    expect(vehicle.currentZoneId).toBe(GL1);
    expect((await jashim.get('/driver/routes')).body.currentZone.name).toBe(
      'Gulshan 1',
    );
  });
});
