import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// Trip lifecycle, fares locked at start, invalid transitions, cancellation rules.
describe('Trip lifecycle (e2e)', () => {
  let app: NestExpressApplication;
  let BAN: string, MOH: string, GL1: string;

  beforeAll(async () => {
    app = await createTestApp();
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

  /** Jashim online with Nusrat (→ Mohakhali) and Rafiq (→ Gulshan 1) in Bullet. */
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

  it("runs the whole trip and locks Nusrat's ৳60 and Rafiq's ৳72 pooled fares", async () => {
    const { jashim, nusrat, rafiq } = await nusratAndRafiqPooled();

    await jashim.post('/driver/pool/arrive').expect(200);
    const started = await jashim.post('/driver/pool/start');
    expect(started.status).toBe(200);
    expect(started.body.pool.status).toBe('STARTED');

    const nusratNow = await nusrat.get('/rides/current');
    const rafiqNow = await rafiq.get('/rides/current');
    expect(nusratNow.body.ride.status).toBe('STARTED');
    expect(nusratNow.body.ride.finalFarePaisa).toBe(6000);
    expect(rafiqNow.body.ride.finalFarePaisa).toBe(7200);

    await jashim.post('/driver/pool/complete').expect(200);
    const done = await nusrat.get('/rides');
    expect(done.body[0]).toMatchObject({
      status: 'COMPLETED',
      farePaisa: 6000,
    });
    expect((await nusrat.get('/rides/current')).body.ride).toBeNull();

    // Jashim is free again.
    expect((await jashim.post('/driver/offline')).status).toBe(200);
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
    await jashim.post('/driver/pool/start').expect(200);

    const now = await nusrat.get('/rides/current');
    expect(now.body.ride.finalFarePaisa).toBe(7500);
  });

  it('rejects invalid state transitions', async () => {
    const { jashim } = await nusratAndRafiqPooled();

    // Start before arriving, complete before starting.
    const startEarly = await jashim.post('/driver/pool/start');
    expect(startEarly.status).toBe(409);
    expect(startEarly.body.code).toBe('INVALID_TRANSITION');
    expect((await jashim.post('/driver/pool/complete')).status).toBe(409);

    await jashim.post('/driver/pool/arrive').expect(200);
    // Arriving twice is not a valid step either.
    expect((await jashim.post('/driver/pool/arrive')).status).toBe(409);
  });

  it('a passenger cannot cancel once the trip has started', async () => {
    const { jashim, nusrat, nusratRideId } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post('/driver/pool/start').expect(200);

    const cancel = await nusrat.post(`/rides/${nusratRideId}/cancel`);
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('INVALID_TRANSITION');
  });

  it('if Rafiq cancels before the start, Nusrat rides alone at her ৳75 estimate', async () => {
    const { jashim, nusrat, rafiq, rafiqRideId } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await rafiq.post(`/rides/${rafiqRideId}/cancel`).expect(200);

    await jashim.post('/driver/pool/start').expect(200);
    const now = await nusrat.get('/rides/current');
    expect(now.body.ride.finalFarePaisa).toBe(7500);
  });

  it('a driver cancelling before the start sends passengers back to waiting', async () => {
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

    // Both are waiting again, and Jashim can accept Nusrat into a fresh pool.
    const waiting = await jashim.get('/driver/requests');
    expect(waiting.body).toHaveLength(2);
  });

  it('a driver cannot cancel a started trip', async () => {
    const { jashim } = await nusratAndRafiqPooled();
    await jashim.post('/driver/pool/arrive').expect(200);
    await jashim.post('/driver/pool/start').expect(200);

    expect((await jashim.post('/driver/pool/cancel')).status).toBe(409);
  });
});
