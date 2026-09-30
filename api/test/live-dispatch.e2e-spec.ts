import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  createDriver,
  createTestApp,
  loginAs,
  resetDatabase,
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
    await app.listen(0); // a real port, for the event stream
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

    /** Opens the stream and resolves with the first "change" event it receives. */
    function firstChange(cookie: string, abort: AbortController) {
      return new Promise<{ topics: string[] }>((resolve, reject) => {
        void fetch(`${baseUrl}/events/stream`, {
          headers: { cookie },
          signal: abort.signal,
        })
          .then(async (response) => {
            expect(response.headers.get('content-type')).toContain(
              'text/event-stream',
            );
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
              const { value, done } = await reader.read();
              if (done) return;
              buffer += decoder.decode(value);
              // Nest writes each event as `event: …`, `id: …`, `data: …`, then a blank line.
              const match = /event: change\n(?:id: .*\n)?data: (.+)\n/.exec(
                buffer,
              );
              if (match) {
                resolve(JSON.parse(match[1]) as { topics: string[] });
                return;
              }
            }
          })
          .catch((error: unknown) => {
            if (!abort.signal.aborted) reject(error);
          });
      });
    }

    it('a driver’s screen hears about a new request the moment it is saved', async () => {
      const cookie = await cookieOf('jashim@teslapool.test', 'DRIVER');
      const abort = new AbortController();
      const heard = firstChange(cookie, abort);
      await new Promise((resolve) => setTimeout(resolve, 200)); // let the stream open

      const nusrat = await loginAs(app, 'nusrat@teslapool.test');
      await nusrat.post('/rides').send(trip(BAN, MOH)).expect(201);

      const event = await heard;
      abort.abort();
      expect(event.topics).toEqual(['requests', 'rides']);
    });

    it('a passenger hears only that rides changed, and reads never publish', async () => {
      const cookie = await cookieOf('nusrat@teslapool.test', 'PASSENGER');
      const abort = new AbortController();
      const heard = firstChange(cookie, abort);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const jashim = await loginAs(app, 'jashim@teslapool.test');
      await jashim.get('/driver/requests').expect(200); // a read: no event
      await jashim.post('/driver/online').expect(200); // an action: one event

      const event = await heard;
      abort.abort();
      expect(event.topics).toEqual(['rides']);
    });

    it('needs a session', async () => {
      const response = await fetch(`${baseUrl}/events/stream`);
      expect(response.status).toBe(401);
    });
  });
});
