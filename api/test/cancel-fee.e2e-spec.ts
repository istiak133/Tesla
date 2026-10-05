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

// The Tk 20 late-cancel fee (D-018): charged once the car is coming straight to the rider's
// stop or is there, paid in cash with their next ride, earned by the driver who came.
describe('Late-cancel fee (e2e)', () => {
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
    [BAN, MOH, GL1] = await Promise.all(
      ['BAN', 'MOH', 'GL1'].map((code) => zoneId(app, code)),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const cancel = (rideId: string) => `/rides/${rideId}/cancel`;
  const passenger = (rideId: string, action: string) =>
    `/driver/pool/passengers/${rideId}/${action}`;

  /** Pretend the rider got the seat this long ago, to pass the 2-minute grace period. */
  const seatedMinutesAgo = (rideId: string, minutes: number) =>
    prisma.poolMember.updateMany({
      where: { rideRequestId: rideId },
      data: { joinedAt: new Date(Date.now() - minutes * 60_000) },
    });

  /** Jashim at Banani with Rafiq (Banani → Gulshan 1); Nusrat waits at Mohakhali. */
  async function nusratAhead() {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    const rafiqRide = await rafiq
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: GL1, seats: 1 });
    await jashim
      .post(`/driver/requests/${rafiqRide.body.id}/accept`)
      .expect(200);
    const nusratRide = await nusrat
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    await runMatcher(app); // she joins on the way (D-023)
    expect((await nusrat.get('/rides/current')).body.ride.status).toBe(
      'MATCHED',
    );
    return {
      jashim,
      nusrat,
      rafiq,
      rafiqRideId: rafiqRide.body.id as string,
      nusratRideId: nusratRide.body.id as string,
    };
  }

  /** Drive Bullet from Banani (Rafiq on board) to the point where it leaves for Mohakhali. */
  async function leaveForMohakhali(
    jashim: Awaited<ReturnType<typeof nusratAhead>>['jashim'],
    rafiqRideId: string,
  ) {
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(passenger(rafiqRideId, 'pickup')).expect(200);
    await jashim.post('/driver/pool/depart').expect(200); // now driving to Mohakhali
  }

  it('is free while the car is still a stop or more away', async () => {
    const { nusrat, nusratRideId } = await nusratAhead();
    await seatedMinutesAgo(nusratRideId, 10);
    const view = (await nusrat.get('/rides/current')).body.ride;
    expect(view.cancelNowFeePaisa).toBe(0); // the car is still at Banani

    const cancelled = await nusrat.post(cancel(nusratRideId));
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 0,
    });
  });

  it('costs Tk 20 once the driver has left for her stop; the screen warns her first', async () => {
    const { jashim, nusrat, rafiqRideId, nusratRideId } = await nusratAhead();
    await leaveForMohakhali(jashim, rafiqRideId);
    await seatedMinutesAgo(nusratRideId, 5);

    expect(
      (await nusrat.get('/rides/current')).body.ride.cancelNowFeePaisa,
    ).toBe(2000);
    const cancelled = await nusrat.post(cancel(nusratRideId));
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 2000,
    });
    expect(cancelled.body.history.at(-1).reason).toBe(
      'Passenger cancelled; Tk 20 fee, paid with the next ride',
    );
    // A double tap does not charge twice.
    expect(
      (await nusrat.post(cancel(nusratRideId))).body.cancellationFeePaisa,
    ).toBe(2000);
  });

  it('is free during the 2-minute grace period after getting the seat', async () => {
    const { jashim, nusrat, rafiqRideId, nusratRideId } = await nusratAhead();
    await leaveForMohakhali(jashim, rafiqRideId);
    // She got the seat moments ago.
    const cancelled = await nusrat.post(cancel(nusratRideId));
    expect(cancelled.body.cancellationFeePaisa).toBe(0);
  });

  it('a no-show at her stop costs the same Tk 20', async () => {
    const { jashim, rafiqRideId, nusratRideId } = await nusratAhead();
    await leaveForMohakhali(jashim, rafiqRideId);
    await jashim.post('/driver/pool/arrive').expect(200); // at Mohakhali
    await seatedMinutesAgo(nusratRideId, 5);
    await jashim.post(passenger(nusratRideId, 'no-show')).expect(200);

    const ride = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: nusratRideId },
    });
    expect(ride).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 2000,
    });
  });

  it('the fee stays owed if her next ride is cancelled too, and is not charged twice', async () => {
    const { jashim, nusrat, rafiqRideId, nusratRideId } = await nusratAhead();
    await leaveForMohakhali(jashim, rafiqRideId);
    await seatedMinutesAgo(nusratRideId, 5);
    await nusrat.post(cancel(nusratRideId)).expect(200); // Tk 20 owed

    // She asks again and cancels while still waiting: free, and the old Tk 20 is still owed.
    const next = await nusrat
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    expect(next.body.duesPaisa).toBe(2000);
    const dropped = await nusrat.post(cancel(next.body.id));
    expect(dropped.body).toMatchObject({
      status: 'CANCELLED',
      cancellationFeePaisa: 0,
    });
    const third = await nusrat
      .post('/rides')
      .send({ pickupZoneId: MOH, dropoffZoneId: GL1, seats: 1 });
    expect(third.body.duesPaisa).toBe(2000); // still Tk 20, not Tk 40
  });

  it('the fee is paid in cash with her next ride, and each driver sees their side', async () => {
    const { jashim, nusrat, rafiqRideId, nusratRideId } = await nusratAhead();
    await leaveForMohakhali(jashim, rafiqRideId);
    await seatedMinutesAgo(nusratRideId, 5);
    await nusrat.post(cancel(nusratRideId)).expect(200);

    // Jashim finishes with Rafiq: that trip earns him the Tk 20 on top.
    await jashim.post('/driver/pool/arrive').expect(200); // Mohakhali
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200); // Gulshan 1
    await jashim.post(passenger(rafiqRideId, 'dropoff')).expect(200);
    const [first] = (await jashim.get('/driver/trips')).body;
    expect(first).toMatchObject({
      cancellationFeesPaisa: 2000,
      lateCancels: ['Nusrat'],
      duesCollectedPaisa: 0,
    });

    // Her next ride shows the Tk 20 due before she pays it.
    await jashim.post('/driver/offline').expect(200);
    await jashim.post('/driver/location').send({ zoneId: BAN }).expect(200);
    await jashim.post('/driver/online').expect(200);
    const next = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(next.body.duesPaisa).toBe(2000);
    await jashim.post(`/driver/requests/${next.body.id}/accept`).expect(200);
    const atStop = await jashim.post('/driver/pool/arrive');
    const shown = atStop.body.pool.passengers.find(
      (p: { rideId: string }) => p.rideId === next.body.id,
    );
    expect(shown.duesPaisa).toBe(2000); // the driver knows to collect it
    await jashim.post(passenger(next.body.id, 'pickup')).expect(200);
    await jashim.post('/driver/pool/depart').expect(200);
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post(passenger(next.body.id, 'dropoff')).expect(200);

    // Paid: the fare plus the old fee, and the old fee is marked paid by this ride.
    const done = (await nusrat.get(`/rides/${next.body.id}`)).body;
    expect(done).toMatchObject({ finalFarePaisa: 7500, duesPaisa: 2000 });
    const old = await prisma.rideRequest.findUniqueOrThrow({
      where: { id: nusratRideId },
    });
    expect(old.feePaidWithRideId).toBe(next.body.id);
    const history = (await nusrat.get('/rides')).body;
    expect(
      history.find((r: { id: string }) => r.id === nusratRideId),
    ).toMatchObject({
      cancellationFeePaisa: 2000,
    });
    expect(
      history.find((r: { id: string }) => r.id === next.body.id),
    ).toMatchObject({
      duesCollectedPaisa: 2000,
    });
    // Nothing is owed any more.
    const again = await nusrat
      .post('/rides')
      .send({ pickupZoneId: BAN, dropoffZoneId: MOH, seats: 1 });
    expect(again.body.duesPaisa).toBe(0);

    // The driver who collected it sees it as the platform's money.
    const [latest] = (await jashim.get('/driver/trips')).body;
    expect(latest.duesCollectedPaisa).toBe(2000);
  });
});
