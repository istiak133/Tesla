import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { MATCH_REASON } from '../src/rides/matcher.service.js';
import {
  createDriver,
  createTestApp,
  loginAs,
  resetDatabase,
  runMatcher,
  seedStoryCast,
  zoneId,
} from './helpers/test-app.js';

// Dispatch to idle cars (D-020): every waiting request reaches every driver who can take it,
// the first to accept gets it, and open screens hear about every change at once (SSE).
describe('Broadcast to drivers, first accept wins, live updates (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let BAN: string, MOH: string, GL1: string, GL2: string, BSH: string;
  const ROUNDS = 5;
  // Each race runs ROUNDS fresh databases and logins: more than vitest's 5 s default.
  const RACE_TIMEOUT_MS = 30_000;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    // createTestApp already listens on 127.0.0.1: the event stream uses that port.
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(async () => {
    await fresh();
  });

  afterAll(async () => {
    await app.close();
  });

  async function fresh() {
    await resetDatabase(app);
    await seedStoryCast(app);
    [BAN, MOH, GL1, GL2, BSH] = await Promise.all(
      ['BAN', 'MOH', 'GL1', 'GL2', 'BSH'].map((code) => zoneId(app, code)),
    );
  }

  const trip = (pickupZoneId: string, dropoffZoneId: string, seats = 1) => ({
    pickupZoneId,
    dropoffZoneId,
    seats,
  });

  /** Jashim and Rahim both idle and online at Banani on Uttara → Bashundhara. */
  async function twoIdleDrivers() {
    await createDriver(app, {
      name: 'Rahim',
      email: 'rahim@teslapool.test',
      zoneCode: 'BAN',
      routeCode: 'UTT-BSH',
    });
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    const rahim = await loginAs(app, 'rahim@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    await rahim.post('/driver/online').expect(200);
    return { jashim, rahim };
  }

  it('a driver’s list holds only the requests that car can take, best first', async () => {
    const jashim = await loginAs(app, 'jashim@teslapool.test');
    await jashim.post('/driver/online').expect(200);
    await jashim.post('/driver/offline').expect(200);
    await jashim.post('/driver/location').send({ zoneId: GL1 }).expect(200);
    await jashim.post('/driver/online').expect(200);

    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const rafiq = await loginAs(app, 'rafiq@teslapool.test');
    const shirin = await loginAs(app, 'shirin@teslapool.test');
    await nusrat.post('/rides').send(trip(BAN, MOH)); // behind the car at Gulshan 1
    const here = await rafiq.post('/rides').send(trip(GL1, BSH));
    const ahead = await shirin.post('/rides').send(trip(GL2, BSH));

    const list = (await jashim.get('/driver/requests')).body;
    expect(list.map((r: { id: string }) => r.id)).toEqual([
      here.body.id,
      ahead.body.id,
    ]);
    expect(list.every((r: { canAccept: boolean }) => r.canAccept)).toBe(true);
  });

  it(
    'race: two drivers accept the same request at the same instant; exactly one gets it',
    async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await fresh();
        const { jashim, rahim } = await twoIdleDrivers();
        const nusrat = await loginAs(app, 'nusrat@teslapool.test');
        const ride = await nusrat.post('/rides').send(trip(BAN, MOH));
        expect(ride.body.status).toBe('REQUESTED'); // no running trip: it goes to both

        const both = await Promise.all([
          jashim.post(`/driver/requests/${ride.body.id}/accept`),
          rahim.post(`/driver/requests/${ride.body.id}/accept`),
        ]);
        const statuses = both.map((response) => response.status).sort();
        expect(statuses).toEqual([200, 409]);
        const loser = both.find((response) => response.status === 409)!;
        expect(loser.body).toMatchObject({
          code: 'ALREADY_TAKEN',
          message: 'Another driver took this request',
        });

        // One seat in one car, and no empty trip left behind for the driver who lost.
        expect(
          await prisma.poolMember.count({
            where: { rideRequestId: ride.body.id },
          }),
        ).toBe(1);
        expect(await prisma.pool.count()).toBe(1);
        expect((await nusrat.get('/rides/current')).body.ride.status).toBe(
          'MATCHED',
        );
      }
    },
    RACE_TIMEOUT_MS,
  );

  it('a request taken by one driver drops out of every other driver’s list', async () => {
    const { jashim, rahim } = await twoIdleDrivers();
    const nusrat = await loginAs(app, 'nusrat@teslapool.test');
    const ride = await nusrat.post('/rides').send(trip(BAN, MOH));
    expect((await rahim.get('/driver/requests')).body).toHaveLength(1);

    await jashim.post(`/driver/requests/${ride.body.id}/accept`).expect(200);
    expect((await rahim.get('/driver/requests')).body).toHaveLength(0);
  });

  // D-022: only a trip's first passenger goes through a driver; after the accept, riders
  // who were already waiting and fit the new trip are seated by the system.
  describe('after the first accept, the system seats the rest', () => {
    it('two first passengers at once: the driver accepts one, the other is seated in that trip', async () => {
      const { jashim, rahim } = await twoIdleDrivers();
      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      const rafiq = await loginAs(app, 'rafiq@teslapool.test');
      const [nusratRide, rafiqRide] = await Promise.all([
        nusrat.post('/rides').send(trip(BAN, MOH)),
        rafiq.post('/rides').send(trip(BAN, GL1)),
      ]);
      // No trip yet: both are first passengers, so both go to both drivers.
      expect([nusratRide.body.status, rafiqRide.body.status]).toEqual([
        'REQUESTED',
        'REQUESTED',
      ]);
      expect((await jashim.get('/driver/requests')).body).toHaveLength(2);

      await jashim
        .post(`/driver/requests/${nusratRide.body.id}/accept`)
        .expect(200);
      // Rafiq now fits a running trip, so he is the matcher's: no driver lists him.
      expect((await rahim.get('/driver/requests')).body).toEqual([]);
      await runMatcher(app);

      // Rafiq did not wait for a second tap: he is in Jashim's car, sharing with Nusrat.
      const rafiqNow = (await rafiq.get('/rides/current')).body.ride;
      expect(rafiqNow.status).toBe('MATCHED');
      expect(rafiqNow.driver.name).toBe('Jashim');
      expect(rafiqNow.coRiders).toEqual(['Nusrat']);
      expect((await jashim.get('/driver/requests')).body).toEqual([]);
      expect((await rahim.get('/driver/requests')).body).toEqual([]);
      const event = await prisma.rideEvent.findFirstOrThrow({
        where: { rideRequestId: rafiqRide.body.id, toStatus: 'MATCHED' },
      });
      expect(event.actorUserId).toBeNull(); // the system, not a driver
      expect(event.reason).toBe(MATCH_REASON);
    });

    it('a request that fits a running trip is shown to no driver; one that fits none is', async () => {
      const { jashim, rahim } = await twoIdleDrivers();
      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      const rafiq = await loginAs(app, 'rafiq@teslapool.test');
      const shirin = await loginAs(app, 'shirin@teslapool.test');
      const nusratRide = await nusrat.post('/rides').send(trip(BAN, MOH));
      await jashim
        .post(`/driver/requests/${nusratRide.body.id}/accept`)
        .expect(200);

      // Rafiq fits Jashim's running trip: the matcher places him, so Rahim, idle at
      // Banani, cannot take him for a new trip, and Jashim cannot grab him either.
      const fits = await rafiq.post('/rides').send(trip(BAN, GL1));
      // Shirin needs 3 seats: no running trip has them, so only an idle car can serve her.
      const tooBig = await shirin.post('/rides').send(trip(BAN, MOH, 3));

      const rahimList = (await rahim.get('/driver/requests')).body;
      expect(rahimList.map((r: { id: string }) => r.id)).toEqual([
        tooBig.body.id,
      ]);
      expect((await jashim.get('/driver/requests')).body).toEqual([]);

      await runMatcher(app);
      expect(
        (
          await prisma.rideRequest.findUniqueOrThrow({
            where: { id: fits.body.id },
          })
        ).status,
      ).toBe('MATCHED');
    });

    it('a rider who does not fit the new trip keeps waiting for a driver', async () => {
      const { jashim } = await twoIdleDrivers();
      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      const rafiq = await loginAs(app, 'rafiq@teslapool.test');
      const shirin = await loginAs(app, 'shirin@teslapool.test');
      const nusratRide = await nusrat.post('/rides').send(trip(BAN, MOH, 2));
      await rafiq.post('/rides').send(trip(BAN, GL1, 2)); // 2 seats: only 1 left after Nusrat
      await shirin.post('/rides').send(trip(MOH, GL2)); // 1 seat, a stop ahead: fits

      await jashim
        .post(`/driver/requests/${nusratRide.body.id}/accept`)
        .expect(200);
      await runMatcher(app);

      expect((await shirin.get('/rides/current')).body.ride.status).toBe(
        'MATCHED',
      );
      expect((await rafiq.get('/rides/current')).body.ride.status).toBe(
        'REQUESTED',
      );
      const pool = await prisma.pool.findFirstOrThrow();
      expect(pool.seatsTaken).toBe(3);
    });

    it(
      'a request saved while the accept is committing still gets a seat in that trip',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          await fresh();
          const { jashim } = await twoIdleDrivers();
          const nusrat = await loginAs(app, 'nusrat@teslapool.test');
          const rafiq = await loginAs(app, 'rafiq@teslapool.test');
          const nusratRide = await nusrat.post('/rides').send(trip(BAN, MOH));

          // Rafiq asks at the very moment Jashim accepts Nusrat. With one trigger per event
          // this was a race (D-022); with batch matching the next round simply sees both.
          const [accepted, rafiqRide] = await Promise.all([
            jashim.post(`/driver/requests/${nusratRide.body.id}/accept`),
            rafiq.post('/rides').send(trip(BAN, GL1)),
          ]);
          expect(accepted.status).toBe(200);
          expect(rafiqRide.status).toBe(201);
          await runMatcher(app);

          const rafiqNow = (await rafiq.get('/rides/current')).body.ride;
          expect(rafiqNow.status).toBe('MATCHED');
          expect(rafiqNow.driver.name).toBe('Jashim');
          const pool = await prisma.pool.findFirstOrThrow();
          expect(pool.seatsTaken).toBe(2);
        }
      },
      RACE_TIMEOUT_MS,
    );
  });

  describe('live updates (Server-Sent Events)', () => {
    const cookieOf = async (email: string, role: string) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ role, email, password: 'tesla1234' })
        .expect(200);
      return (response.headers['set-cookie'] as unknown as string[])[0].split(
        ';',
      )[0];
    };

    /**
     * Opens the stream and resolves once its headers have arrived: Nest subscribes the stream
     * in the same tick as it sends them, so from then on no change can be missed (no sleep).
     * `firstChange` resolves with the first "change" event.
     */
    async function openStream(cookie: string, abort: AbortController) {
      const response = await fetch(`${baseUrl}/events/stream`, {
        headers: { cookie },
        signal: abort.signal,
      });
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      const reader = response.body!.getReader();
      const firstChange = (async () => {
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) throw new Error('stream ended before a change');
          buffer += decoder.decode(value);
          // Nest writes each event as `event: …`, `id: …`, `data: …`, then a blank line.
          const match = /event: change\n(?:id: .*\n)?data: (.+)\n/.exec(buffer);
          if (match) {
            return JSON.parse(match[1]) as { topics: string[] };
          }
        }
      })();
      // Aborting at the end of a test rejects the pending read: that is not a failure.
      firstChange.catch(() => undefined);
      return { firstChange };
    }

    it('a driver’s screen hears about a new request the moment it is saved', async () => {
      const cookie = await cookieOf('jashim@teslapool.test', 'DRIVER');
      const abort = new AbortController();
      const stream = await openStream(cookie, abort);

      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      await nusrat.post('/rides').send(trip(BAN, MOH)).expect(201);

      const event = await stream.firstChange;
      abort.abort();
      expect(event.topics).toEqual(['requests', 'rides']);
    });

    it('a passenger hears only that rides changed', async () => {
      const cookie = await cookieOf('nusrat@teslapool.test', 'PASSENGER');
      const abort = new AbortController();
      const stream = await openStream(cookie, abort);

      const jashim = await loginAs(app, 'jashim@teslapool.test');
      await jashim.post('/driver/online').expect(200); // an action: one event

      const event = await stream.firstChange;
      abort.abort();
      expect(event.topics).toEqual(['rides']);
    });

    it('reads never publish; an action publishes once', async () => {
      // Watched at the source, so a read that published would be seen whatever the topics.
      const published: string[][] = [];
      const subscription = app
        .get(RealtimeService)
        .stream.subscribe((topics) => published.push(topics));
      try {
        const jashim = await loginAs(app, 'jashim@teslapool.test');
        await jashim.get('/driver/pool').expect(200);
        await jashim.get('/driver/requests').expect(200);
        await jashim.get('/driver/trips').expect(200);
        const nusrat = await loginAs(app, 'nusrat@teslapool.test');
        await nusrat.get('/rides/current').expect(200);
        await nusrat.get('/rides').expect(200);
        expect(published).toEqual([]);

        await jashim.post('/driver/online').expect(200);
        expect(published).toEqual([['requests', 'rides']]);
      } finally {
        subscription.unsubscribe();
      }
    });

    it('needs a session', async () => {
      const response = await fetch(`${baseUrl}/events/stream`);
      expect(response.status).toBe(401);
    });
  });
});
