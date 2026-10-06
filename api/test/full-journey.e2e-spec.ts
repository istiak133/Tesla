import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { MATCH_REASON } from '../src/rides/matcher.service.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  waitedAtStop,
} from './helpers/test-app.js';

// One whole morning on Airport Road, only through the HTTP API, the way the web app uses it.
// Every feature has its own spec; this one checks that they work together:
// passengers, the driver and the pool, from sign-up to the money split.
describe('A full trip, end to end (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedStoryCast(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the story from sign-up to the driver’s earnings', async () => {
    const server = request(app.getHttpServer());

    // ---------- public reference data ----------
    expect((await server.get('/health')).body).toEqual({
      status: 'ok',
      database: 'up',
    });
    const zones = (await server.get('/zones')).body as {
      id: string;
      code: string;
    }[];
    expect(zones).toHaveLength(14);
    const zone = (code: string) => zones.find((z) => z.code === code)!.id;
    const [UTT, BAN, MOH, GL1, BSH] = ['UTT', 'BAN', 'MOH', 'GL1', 'BSH'].map(
      zone,
    );
    expect((await server.get('/routes')).body).toHaveLength(6);
    const fromBanani = await server.get(`/zones/${BAN}/destinations`);
    expect(fromBanani.body.map((z: { code: string }) => z.code)).toEqual(
      expect.arrayContaining(['MOH', 'GL1', 'UTT']),
    );

    // ---------- a new passenger signs up; roles are enforced ----------
    const karim = request.agent(app.getHttpServer());
    const signup = await karim.post('/auth/signup/passenger').send({
      name: 'Karim Uddin',
      email: 'Karim@Example.com',
      phone: '01811-223344',
      password: 'karim-pass-1',
      presentAddress: 'House 3, Road 12, Banani, Dhaka 1213',
      permanentAddress: 'Station Road, Rangpur',
    });
    expect(signup.status).toBe(201);
    expect(signup.body).toMatchObject({
      email: 'karim@example.com',
      role: 'PASSENGER',
    });
    expect((await karim.get('/driver/pool')).status).toBe(403);

    // ---------- the driver: location, suggestion, route, online ----------
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');

    const start = await jashim.get('/driver/pool');
    expect(start.body.vehicle).toMatchObject({
      name: 'Bullet',
      seatCapacity: 3,
      isOnline: false,
      route: { name: 'Uttara → Bashundhara' },
      currentZone: { name: 'Banani' },
    });
    expect(start.body.pool).toBeNull();
    const suggestion = await jashim.get('/driver/routes');
    expect(suggestion.body.currentZone.name).toBe('Banani');
    expect(suggestion.body.suggestedRouteId).not.toBeNull();
    await jashim.post('/driver/online').expect(200);

    // ---------- Nusrat waits; Jashim accepts ----------
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(nusratRide.body).toMatchObject({
      status: 'REQUESTED',
      estimatedFarePaisa: 7500,
      distanceKm: 3,
    });
    const waiting = await jashim.get('/driver/requests');
    expect(waiting.body).toEqual([
      expect.objectContaining({ passengerName: 'Nusrat', canAccept: true }),
    ]);
    const accepted = await jashim.post(
      `/driver/requests/${nusratRide.body.id}/accept`,
    );
    expect(accepted.body.pool).toMatchObject({
      status: 'MATCHED',
      route: 'Uttara → Bashundhara',
      currentStop: 1, // heading to Banani
      seatsTaken: 1,
    });

    // ---------- Rafiq joins at the next round; Karim goes the other way ----------
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(rafiqRide.body.status).toBe('REQUESTED');
    await runMatcher(app);
    expect((await rafiq.get('/rides/current')).body.ride).toMatchObject({
      status: 'MATCHED',
      coRiders: ['Nusrat'],
      driver: { name: 'Jashim', vehicleName: 'Bullet' },
      route: { pickupStop: 1, dropoffStop: 3, carStop: 1, carAtStop: false },
    });
    const karimRide = await karim
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: UTT, seats: 1 });
    expect(karimRide.body.status).toBe('REQUESTED');
    // Not for this car: it is not in Jashim's list, and a driver on a trip cannot accept
    // anyone by hand (D-020, D-023).
    expect((await jashim.get('/driver/requests')).body).toEqual([]);
    const wrongWay = await jashim.post(
      `/driver/requests/${karimRide.body.id}/accept`,
    );
    expect(wrongWay.body).toMatchObject({ code: 'HAS_ACTIVE_POOL' });

    // Privacy: nobody reads another passenger's ride.
    expect((await nusrat.get(`/rides/${rafiqRide.body.id}`)).status).toBe(403);

    // ---------- Banani: arrive, both get in, leave ----------
    await jashim.post('/driver/pool/arrive').expect(200);
    expect((await nusrat.get('/rides/current')).body.ride.status).toBe(
      'DRIVER_ARRIVED',
    );
    await jashim
      .post(`/driver/pool/passengers/${nusratRide.body.id}/pickup`)
      .expect(200);
    await jashim
      .post(`/driver/pool/passengers/${rafiqRide.body.id}/pickup`)
      .expect(200);
    expect(
      (await nusrat.post(`/rides/${nusratRide.body.id}/cancel`)).status,
    ).toBe(409); // in the car
    const left = await jashim.post('/driver/pool/depart');
    expect(left.body.pool).toMatchObject({ status: 'STARTED', currentStop: 2 });

    // ---------- on the way: Shirin joins at Mohakhali, the car is now full ----------
    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: BSH, seats: 1 });
    expect(shirinRide.body.estimatedFarePaisa).toBe(13500);
    await runMatcher(app);
    expect((await shirin.get('/rides/current')).body.ride.status).toBe(
      'MATCHED',
    );
    expect((await jashim.get('/driver/pool')).body.pool.seatsTaken).toBe(3);

    // Karim gives up on Uttara and asks for Mohakhali → Gulshan 1: no seat yet.
    await karim.post(`/rides/${karimRide.body.id}/cancel`).expect(200);
    const karimSecond = await karim
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    expect(karimSecond.body.status).toBe('REQUESTED');
    expect((await runMatcher(app)).seated).toBe(0); // Bullet is full
    // Bullet is full, so it is not in Jashim's list until a seat frees (D-020).
    expect((await jashim.get('/driver/requests')).body).toEqual([]);

    // Mid-trip the driver cannot walk away or change route.
    expect((await jashim.post('/driver/offline')).status).toBe(409);
    expect((await jashim.post('/driver/pool/cancel')).status).toBe(409);

    // ---------- Mohakhali: Nusrat gets off; the next round gives her seat to Karim (D-017) ----------
    await jashim.post('/driver/pool/arrive').expect(200);
    expect((await jashim.post('/driver/pool/depart')).status).toBe(409); // people to handle here
    await jashim
      .post(`/driver/pool/passengers/${nusratRide.body.id}/dropoff`)
      .expect(200);
    await runMatcher(app);
    const karimNow = (await karim.get('/rides/current')).body.ride;
    expect(karimNow.status).toBe('DRIVER_ARRIVED'); // seated, and the car is at his stop
    expect(karimNow.history.map((e: { reason: string }) => e.reason)).toContain(
      MATCH_REASON,
    );
    await jashim
      .post(`/driver/pool/passengers/${shirinRide.body.id}/pickup`)
      .expect(200);
    // …but Karim is not there. The car waits the no-show time first.
    await waitedAtStop(app);
    const noShow = await jashim.post(
      `/driver/pool/passengers/${karimSecond.body.id}/no-show`,
    );
    expect(noShow.body.pool.seatsTaken).toBe(2);

    // ---------- Gulshan 1, Gulshan 2, Bashundhara ----------
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim
      .post(`/driver/pool/passengers/${rafiqRide.body.id}/dropoff`)
      .expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200); // Gulshan 2: nobody here
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    const last = await jashim.post(
      `/driver/pool/passengers/${shirinRide.body.id}/dropoff`,
    );
    expect(last.body.pool).toBeNull(); // the trip closed itself
    expect(last.body.vehicle.currentZone.name).toBe('Bashundhara');

    // ---------- fares: everyone shared a hop ----------
    const fares = await Promise.all([
      nusrat.get(`/rides/${nusratRide.body.id}`),
      rafiq.get(`/rides/${rafiqRide.body.id}`),
      shirin.get(`/rides/${shirinRide.body.id}`),
    ]);
    expect(fares.map((r) => r.body.finalFarePaisa)).toEqual([
      6000, 7200, 10800,
    ]);
    expect(fares.map((r) => r.body.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
    ]);

    // ---------- the history explains exactly what happened ----------
    const nusratHistory = fares[0].body.history.map(
      (event: { reason: string }) => event.reason,
    );
    expect(nusratHistory).toEqual([
      'Passenger requested a ride',
      'Driver accepted the request',
      'Driver arrived at Banani',
      'Picked up at Banani',
      'Dropped off at Mohakhali; shared ride, 20% off; pay in cash',
    ]);
    const karimHistory = (
      await karim.get(`/rides/${karimSecond.body.id}`)
    ).body.history.map((event: { reason: string }) => event.reason);
    // The car waited the no-show time, which is past the grace period: Tk 20 (D-018).
    expect(karimHistory).toContain(
      'Did not show up at Mohakhali; Tk 20 fee, paid with the next ride',
    );

    // ---------- the money: driver paid for the work, platform keeps the rest ----------
    const trips = await jashim.get('/driver/trips');
    expect(trips.body[0]).toMatchObject({
      status: 'COMPLETED',
      route: 'Uttara → Bashundhara',
      collectedPaisa: 24000,
      driverEarningsPaisa: 18000, // 12 km × ৳10 + 3 pickups × ৳20 (a no-show is not a pickup)
      platformFeePaisa: 6000,
    });
    expect(trips.body[0].passengers).toHaveLength(3);

    // ---------- histories, the next suggestion, going home ----------
    const nusratRides = await nusrat.get('/rides');
    expect(nusratRides.body[0]).toMatchObject({
      status: 'COMPLETED',
      farePaisa: 6000,
    });
    const next = await jashim.get('/driver/routes');
    expect(next.body.currentZone.name).toBe('Bashundhara');
    expect(next.body.routes[0]).toMatchObject({
      name: 'Bashundhara → Uttara',
      passesYou: true,
    });
    await jashim.post('/driver/offline').expect(200);

    await nusrat.post('/auth/logout').expect(204);
    expect((await nusrat.get('/auth/me')).status).toBe(401);
  });
});
