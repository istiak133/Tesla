import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// The trip stop by stop: arrive, pick up, drop off, depart. Fares locked at drop-off,
// invalid transitions, no-shows and cancellation rules.
describe('Trip lifecycle (e2e)', () => {
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
    BAN = await zoneId(app, 'BAN');
    MOH = await zoneId(app, 'MOH');
    GL1 = await zoneId(app, 'GL1');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Jashim online with Nusrat (→ Mohakhali) and Rafiq (→ Gulshan 1), both waiting at Banani. */
  async function nusratAndRafiqPooled() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    await jashim.post('/driver/online').expect(200);

    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect(rafiqRide.body.status).toBe('MATCHED');

    return {
      jashim,
      nusrat,
      rafiq,
      nusratRideId: nusratRide.body.id as string,
      rafiqRideId: rafiqRide.body.id as string,
    };
  }

  const pickup = (rideId: string) => `/driver/pool/passengers/${rideId}/pickup`;
  const dropoff = (rideId: string) =>
    `/driver/pool/passengers/${rideId}/dropoff`;

  it('drives the whole route: Nusrat pays ৳60 and Rafiq ৳72 for sharing', async () => {
    const { jashim, nusrat, rafiq, nusratRideId, rafiqRideId } =
      await nusratAndRafiqPooled();

    // Banani: both are waiting, both get in.
    const atBanani = await jashim.post('/driver/pool/arrive');
    expect(atBanani.body.pool.status).toBe('DRIVER_ARRIVED');
    expect((await nusrat.get('/rides/current')).body.ride.status).toBe(
      'DRIVER_ARRIVED',
    );
    await jashim.post(pickup(nusratRideId)).expect(200);
    await jashim.post(pickup(rafiqRideId)).expect(200);
    expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
      'STARTED',
    );

    // Mohakhali: Nusrat gets off, her fare is locked.
    const leaving = await jashim.post('/driver/pool/depart');
    expect(leaving.body.pool).toMatchObject({
      status: 'STARTED',
      currentStop: 2,
    });
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(dropoff(nusratRideId)).expect(200);
    const nusratDone = await nusrat.get('/rides');
    expect(nusratDone.body[0]).toMatchObject({
      status: 'COMPLETED',
      farePaisa: 6000,
    });
    expect((await nusrat.get('/rides/current')).body.ride).toBeNull();

    // Gulshan 1: Rafiq gets off. Nobody is left, so the trip is complete.
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    const last = await jashim.post(dropoff(rafiqRideId));
    expect(last.body.pool).toBeNull();
    expect((await rafiq.get(`/rides/${rafiqRideId}`)).body).toMatchObject({
      status: 'COMPLETED',
      finalFarePaisa: 7200,
    });

    // Jashim is free again, and the trip is in his history with both fares.
    expect((await jashim.post('/driver/offline')).status).toBe(200);
    const trips = await jashim.get('/driver/trips');
    expect(trips.body[0]).toMatchObject({
      status: 'COMPLETED',
      route: 'Uttara → Bashundhara',
      totalFarePaisa: 13200, // ৳60 + ৳72
    });
    expect(trips.body[0].passengers).toHaveLength(2);
  });

  it('a passenger riding alone pays the solo estimate', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const ride = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);

    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(ride.body.id)).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(dropoff(ride.body.id)).expect(200);

    const done = await nusrat.get(`/rides/${ride.body.id}`);
    expect(done.body.finalFarePaisa).toBe(7500);
  });

  it('taking over a seat where someone got off is not sharing', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    await jashim.post('/driver/online').expect(200);

    // Nusrat Banani → Mohakhali, then Shirin Mohakhali → Gulshan 1 (3 km, ৳75 alone).
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    await jashim
      .post(`/driver/requests/${nusratRide.body.id}/accept`)
      .expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(nusratRide.body.id)).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);

    const shirinRide = await shirin
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    expect(shirinRide.body.status).toBe('MATCHED');

    // At Mohakhali the driver lets Shirin in before Nusrat is out: still no shared hop.
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(shirinRide.body.id)).expect(200);
    await jashim.post(dropoff(nusratRide.body.id)).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(dropoff(shirinRide.body.id)).expect(200);

    expect(
      (await nusrat.get(`/rides/${nusratRide.body.id}`)).body.finalFarePaisa,
    ).toBe(7500);
    expect(
      (await shirin.get(`/rides/${shirinRide.body.id}`)).body.finalFarePaisa,
    ).toBe(7500);
  });

  it('rejects steps in the wrong order', async () => {
    const { jashim, nusratRideId, rafiqRideId } = await nusratAndRafiqPooled();

    // Leaving or picking up before arriving.
    const early = await jashim.post('/driver/pool/depart');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('INVALID_TRANSITION');
    expect((await jashim.post(pickup(nusratRideId))).status).toBe(409);

    await jashim.post('/driver/pool/arrive').expect(200);
    // Arriving twice, or leaving while passengers still wait at the stop.
    expect((await jashim.post('/driver/pool/arrive')).status).toBe(409);
    expect((await jashim.post('/driver/pool/depart')).status).toBe(409);

    // Dropping off someone who is not in the car, or at the wrong stop.
    expect((await jashim.post(dropoff(nusratRideId))).status).toBe(409);
    await jashim.post(pickup(nusratRideId)).expect(200);
    await jashim.post(pickup(rafiqRideId)).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    expect((await jashim.post(dropoff(rafiqRideId))).status).toBe(409); // Rafiq goes to Gulshan 1
  });

  it('a passenger can cancel while the car waits, but not after pickup', async () => {
    const { jashim, nusrat, rafiq, nusratRideId, rafiqRideId } =
      await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(nusratRideId)).expect(200);

    const cancelInCar = await nusrat.post(`/rides/${nusratRideId}/cancel`);
    expect(cancelInCar.status).toBe(409);
    expect(cancelInCar.body.code).toBe('INVALID_TRANSITION');

    const cancelAtStop = await rafiq.post(`/rides/${rafiqRideId}/cancel`);
    expect(cancelAtStop.status).toBe(200);
    expect(cancelAtStop.body.status).toBe('CANCELLED');
  });

  it('if Rafiq cancels before pickup, Nusrat rides alone at her ৳75 estimate', async () => {
    const { jashim, nusrat, rafiq, nusratRideId, rafiqRideId } =
      await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await rafiq.post(`/rides/${rafiqRideId}/cancel`).expect(200);

    await jashim.post(pickup(nusratRideId)).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(dropoff(nusratRideId)).expect(200);
    expect(
      (await nusrat.get(`/rides/${nusratRideId}`)).body.finalFarePaisa,
    ).toBe(7500);
  });

  it('a no-show frees the seat, and an empty trip is closed', async () => {
    const { jashim, nusrat, rafiq, nusratRideId, rafiqRideId } =
      await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);

    const noShow = await jashim.post(
      `/driver/pool/passengers/${nusratRideId}/no-show`,
    );
    expect(noShow.body.pool.seatsTaken).toBe(1);
    expect((await nusrat.get(`/rides/${nusratRideId}`)).body.status).toBe(
      'CANCELLED',
    );

    await jashim
      .post(`/driver/pool/passengers/${rafiqRideId}/no-show`)
      .expect(200);
    expect((await rafiq.get(`/rides/${rafiqRideId}`)).body.status).toBe(
      'CANCELLED',
    );
    // Nobody was ever in the car, so the trip is cancelled, not completed.
    const pool = await prisma.pool.findFirstOrThrow();
    expect(pool.status).toBe('CANCELLED');
  });

  it('a driver cancelling before the first pickup sends passengers back to waiting', async () => {
    const { jashim, nusrat, rafiq } = await nusratAndRafiqPooled();

    const cancelled = await jashim.post('/driver/pool/cancel');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.pool).toBeNull();

    expect((await nusrat.get('/rides/current')).body.ride.status).toBe(
      'REQUESTED',
    );
    expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
      'REQUESTED',
    );

    // Both are waiting again, and Jashim can accept them into a fresh trip.
    const waiting = await jashim.get('/driver/requests');
    expect(waiting.body).toHaveLength(2);
  });

  it('a driver cannot cancel once someone has been picked up', async () => {
    const { jashim, nusratRideId } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(nusratRideId)).expect(200);

    expect((await jashim.post('/driver/pool/cancel')).status).toBe(409);
  });
});
