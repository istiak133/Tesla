import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { seedGeography } from '../../src/seed/seed-data.js';

/** Starts the whole API the same way main.ts does, against the real test database. */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  // Listen once, on 127.0.0.1 itself. Left to itself, SuperTest listens on "::" for every
  // batch of requests and then connects to 127.0.0.1:<port>. On macOS a "::" listener can
  // share a port that another program holds on 127.0.0.1 (editor helpers do), and the
  // connection then reaches that program instead: the rare, unexplained 401s and 404s in
  // the middle of a test (D-021). Binding 127.0.0.1 makes the kernel give a port that is
  // free there, and SuperTest reuses this server instead of opening its own.
  await app.listen(0, '127.0.0.1');
  return app;
}

/**
 * Deletes all rows so every test starts from a known state,
 * then puts back the zones, distances and routes that every ride needs.
 */
export async function resetDatabase(app: NestExpressApplication) {
  const prisma = app.get(PrismaService);

  // Safety check: never wipe a database that is not a test database.
  const rows = await prisma.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  const databaseName = rows[0]?.name ?? '';
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to reset "${databaseName}": e2e tests must use a *_test database`,
    );
  }

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ride_events", "pool_members", "pools", "ride_requests", "vehicles", "driver_profiles", "sessions", "users", "route_stops", "routes", "zone_distances", "zones" RESTART IDENTITY CASCADE',
  );
  await seedGeography(prisma);
}

// ---------- helpers for ride tests ----------

import request from 'supertest';
import { hashPassword } from '../../src/auth/password.js';
import { DEMO_PASSWORD, seedCast } from '../../src/seed/seed-data.js';

export async function seedStoryCast(app: NestExpressApplication) {
  await seedCast(app.get(PrismaService));
}

/** Extra passengers for concurrency tests (all use the demo password). */
export async function createPassengers(
  app: NestExpressApplication,
  count: number,
): Promise<string[]> {
  const prisma = app.get(PrismaService);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const emails: string[] = [];
  for (let i = 1; i <= count; i++) {
    const email = `rider${i}@teslapool.test`;
    await prisma.user.create({
      data: { name: `Rider ${i}`, email, passwordHash, role: 'PASSENGER' },
    });
    emails.push(email);
  }
  return emails;
}

/** A supertest agent logged in as this user (keeps the session cookie). */
export async function loginAs(app: NestExpressApplication, email: string) {
  const agent = request.agent(app.getHttpServer());
  // The login page asks for the account type (D-015); the helper reads it from the user.
  const { role } = await app
    .get(PrismaService)
    .user.findUniqueOrThrow({ where: { email } });
  const response = await agent
    .post('/auth/login')
    .send({ role, email, password: DEMO_PASSWORD });
  if (response.status !== 200) {
    throw new Error(
      `Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return agent;
}

export async function zoneId(
  app: NestExpressApplication,
  code: string,
): Promise<string> {
  const zone = await app
    .get(PrismaService)
    .zone.findUniqueOrThrow({ where: { code } });
  return zone.id;
}

/** A second driver and car for matching tests, placed at a zone on a route. */
export async function createDriver(
  app: NestExpressApplication,
  driver: { name: string; email: string; zoneCode: string; routeCode: string },
) {
  const prisma = app.get(PrismaService);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.create({
    data: {
      name: driver.name,
      email: driver.email,
      passwordHash,
      role: 'DRIVER',
    },
  });
  const route = await prisma.route.findUniqueOrThrow({
    where: { code: driver.routeCode },
  });
  const zone = await prisma.zone.findUniqueOrThrow({
    where: { code: driver.zoneCode },
  });
  await prisma.vehicle.create({
    data: {
      driverId: user.id,
      name: `${driver.name}'s car`,
      seatCapacity: 3,
      routeId: route.id,
      currentZoneId: zone.id,
    },
  });
}

// ---------- batch matching (D-023) ----------

import { MatcherService } from '../../src/rides/matcher.service.js';

/**
 * Runs one match round now. In tests the timer is off, so a test decides exactly when the
 * waiting requests are matched, and what it checks never depends on timing.
 */
export async function runMatcher(app: NestExpressApplication) {
  return app.get(MatcherService).runOnce();
}

/**
 * Several matchers racing for seats at once: each seat here is its own one-seat plan, and
 * all are applied in parallel through the real write path (the car's lock, R1–R4 again,
 * the compare-and-set and the conditional seat update). This is what happens if two API
 * instances run a round at the same moment, and it is the hardest form of the
 * "same instant" race: the plans themselves disagree.
 */
export async function applyInParallel(
  app: NestExpressApplication,
  seats: { vehicleId: string; poolId: string; rideId: string }[],
) {
  const matcher = app.get(MatcherService);
  return Promise.all(
    seats.map((seat) =>
      matcher.apply({
        trips: [
          {
            vehicleId: seat.vehicleId,
            poolId: seat.poolId,
            requestIds: [seat.rideId],
          },
        ],
        seatsServed: 1,
        optimal: true,
      }),
    ),
  );
}
