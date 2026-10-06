import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  waitedAtStop,
  zoneId,
} from './helpers/test-app.js';

// The trip stop by stop: arrive, pick up, drop off, depart. Fares locked at drop-off,
// invalid transitions, no-shows and cancellation rules.
describe('Trip lifecycle (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let BAN: string, MOH: string, GL1: string;

  // A race runs several fresh databases and logins: more than the 20 s default.
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
    // Rafiq fits Bullet's running trip: the next match round seats him (D-023).
    await runMatcher(app);
    expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
      'MATCHED',
    );

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
    const nusratOff = await jashim.post(dropoff(nusratRideId)).expect(200);
    // The driver sees what to collect: the final fare, not the estimate.
    expect(nusratOff.body.receipt).toEqual({
      rideId: nusratRideId,
      passengerName: 'Nusrat',
      finalFarePaisa: 6000,
      duesCollectedPaisa: 0,
      totalPaisa: 6000,
      shared: true,
    });
    const nusratDone = await nusrat.get('/rides');
    expect(nusratDone.body[0]).toMatchObject({
      status: 'COMPLETED',
      farePaisa: 6000,
    });
    // No active ride, but her screen still shows the ride that just ended, with the fare.
    const afterDropOff = (await nusrat.get('/rides/current')).body;
    expect(afterDropOff.ride).toBeNull();
    expect(afterDropOff.lastEnded).toMatchObject({
      id: nusratRideId,
      status: 'COMPLETED',
      finalFarePaisa: 6000,
    });

    // Gulshan 1: Rafiq gets off. Nobody is left, so the trip is complete.
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    const last = await jashim.post(dropoff(rafiqRideId));
    expect(last.body.pool).toBeNull();
    // The trip is closed, but the answer still says what to collect from the last rider.
    expect(last.body.receipt).toMatchObject({
      passengerName: 'Rafiq',
      totalPaisa: 7200,
    });
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
      collectedPaisa: 13200, // ৳60 + ৳72 in cash
      driverEarningsPaisa: 10000, // 6 km × ৳10 + 2 pickups × ৳20
      platformFeePaisa: 3200, // the rest
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
    await runMatcher(app);
    expect((await shirin.get('/rides/current')).body.ride.status).toBe(
      'MATCHED',
    );

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

    // Not before the car has waited at the stop.
    const early = await jashim.post(
      `/driver/pool/passengers/${nusratRideId}/no-show`,
    );
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({
      code: 'TOO_EARLY',
      message: 'Wait 3 minutes at the stop before marking a no-show',
    });
    expect(
      (await jashim.get('/driver/pool')).body.pool.passengers.find(
        (p: { rideId: string }) => p.rideId === nusratRideId,
      ).noShowFrom,
    ).not.toBeNull();

    await waitedAtStop(app);
    const noShow = await jashim.post(
      `/driver/pool/passengers/${nusratRideId}/no-show`,
    );
    expect(noShow.body.pool.seatsTaken).toBe(1);
    expect((await nusrat.get(`/rides/${nusratRideId}`)).body.status).toBe(
      'CANCELLED',
    );
    // Her screen says why the ride ended.
    const ended = (await nusrat.get('/rides/current')).body.lastEnded;
    expect(ended.status).toBe('CANCELLED');
    expect(ended.history.at(-1).reason).toMatch(/^Did not show up at Banani/);

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

  it('a rider seated at the stop after the car arrived does not stop it leaving; she waits again, free', async () => {
    const { jashim, nusratRideId, rafiqRideId } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(nusratRideId)).expect(200);
    await jashim.post(pickup(rafiqRideId)).expect(200);

    // Shirin asks at Banani while Bullet stands there: the round seats her at once…
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    const ride = await shirin
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    expect((await runMatcher(app)).seated).toBe(1);
    expect((await shirin.get('/rides/current')).body.ride.status).toBe(
      'DRIVER_ARRIVED',
    );

    const shirinSeat = (
      await jashim.get('/driver/pool')
    ).body.pool.passengers.find((p: { name: string }) => p.name === 'Shirin');
    expect(shirinSeat).toMatchObject({ seatedAfterArrival: true });
    // …but she may be far away inside the zone, so the driver can still leave.
    const left = await jashim.post('/driver/pool/depart').expect(200);
    expect(left.body.pool).toMatchObject({ status: 'STARTED', seatsTaken: 2 });
    const now = (await shirin.get('/rides/current')).body.ride;
    expect(now.status).toBe('REQUESTED');
    expect(now.cancellationFeePaisa).toBe(0);
    expect(now.history.at(-1).reason).toBe(
      'The car left Banani before you reached it; finding you another seat',
    );
    expect(ride.body.id).toBe(now.id);
    // The seat is taken back, so this trip can never count her ride if another car carries her.
    expect(
      await prisma.poolMember.count({ where: { rideRequestId: now.id } }),
    ).toBe(0);
  });

  it('a rider seated before the car arrived still holds it until picked up or a no-show', async () => {
    const { jashim } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    const leave = await jashim.post('/driver/pool/depart');
    expect(leave.status).toBe(409);
    expect(leave.body.message).toBe(
      'Pick up, drop off or mark no-show everyone at this stop first',
    );
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

  it(
    'a passenger cancelling while the driver cancels the trip always gets a clean answer',
    { timeout: RACE_TIMEOUT_MS },
    async () => {
      // Race both ways several times: whichever wins, Nusrat ends CANCELLED with a 200,
      // never a wrong 409, and Rafiq is back to waiting.
      for (let round = 0; round < 5; round++) {
        await resetDatabase(app);
        await seedStoryCast(app);
        BAN = await zoneId(app, 'BAN');
        MOH = await zoneId(app, 'MOH');
        GL1 = await zoneId(app, 'GL1');
        const { jashim, nusrat, rafiq, nusratRideId } =
          await nusratAndRafiqPooled();

        const [passengerCancel, driverCancel] = await Promise.all([
          nusrat.post(`/rides/${nusratRideId}/cancel`),
          jashim.post('/driver/pool/cancel'),
        ]);

        expect(passengerCancel.status).toBe(200);
        expect(passengerCancel.body.status).toBe('CANCELLED');
        expect(driverCancel.status).toBe(200);
        expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
          'REQUESTED',
        );
      }
    },
  );

  it('a driver cannot cancel once someone has been picked up', async () => {
    const { jashim, nusratRideId } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(pickup(nusratRideId)).expect(200);

    expect((await jashim.post('/driver/pool/cancel')).status).toBe(409);
  });
});
