// Seed steps shared by the seed script and the e2e tests.
// Every step upserts by a natural key, so running it again changes nothing.
import { hashPassword } from '../auth/password.js';
import { kmFromStart, routeDirections } from '../geography/dhaka-routes.js';
import { DISTANCE_KM, ZONES } from '../geography/dhaka-zones.js';
import { PrismaClient, Role } from '../generated/prisma/client.js';

// Shared demo password, listed in the README. For local and demo use only.
export const DEMO_PASSWORD = 'tesla1234';

export const CAST = [
  { name: 'Jashim', email: 'jashim@teslapool.test', role: Role.DRIVER },
  { name: 'Nusrat', email: 'nusrat@teslapool.test', role: Role.PASSENGER },
  { name: 'Rafiq', email: 'rafiq@teslapool.test', role: Role.PASSENGER },
  { name: 'Shirin', email: 'shirin@teslapool.test', role: Role.PASSENGER },
];

export async function seedGeography(prisma: PrismaClient): Promise<void> {
  const zoneIdByCode = new Map<string, string>();
  for (const zone of ZONES) {
    const saved = await prisma.zone.upsert({
      where: { code: zone.code },
      update: { name: zone.name },
      create: { code: zone.code, name: zone.name },
    });
    zoneIdByCode.set(zone.code, saved.id);
  }

  // Distances in both directions, one row per ordered pair of different zones.
  for (let i = 0; i < ZONES.length; i++) {
    for (let j = 0; j < ZONES.length; j++) {
      if (i === j) {
        continue;
      }
      const fromZoneId = zoneIdByCode.get(ZONES[i].code)!;
      const toZoneId = zoneIdByCode.get(ZONES[j].code)!;
      await prisma.zoneDistance.upsert({
        where: { fromZoneId_toZoneId: { fromZoneId, toZoneId } },
        update: { km: DISTANCE_KM[i][j] },
        create: { fromZoneId, toZoneId, km: DISTANCE_KM[i][j] },
      });
    }
  }

  // Routes, each direction on its own, with stops in driving order.
  const zoneNameByCode = new Map<string, string>(
    ZONES.map((zone) => [zone.code, zone.name]),
  );
  for (const route of routeDirections()) {
    const first = zoneNameByCode.get(route.stops[0])!;
    const last = zoneNameByCode.get(route.stops[route.stops.length - 1])!;
    const saved = await prisma.route.upsert({
      where: { code: route.code },
      update: { name: `${first} → ${last}` },
      create: { code: route.code, name: `${first} → ${last}` },
    });
    const km = kmFromStart(route.stops);
    for (let position = 0; position < route.stops.length; position++) {
      const zoneId = zoneIdByCode.get(route.stops[position])!;
      const stop = { zoneId, kmFromStart: km[position] };
      await prisma.routeStop.upsert({
        where: { routeId_position: { routeId: saved.id, position } },
        update: stop,
        create: { routeId: saved.id, position, ...stop },
      });
    }
  }
}

// The route Jashim drives in the story: Uttara → Banani → Mohakhali → Gulshan 1 → …
export const JASHIM_ROUTE_CODE = 'UTT-BSH';

export async function seedCast(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const person of CAST) {
    await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, role: person.role },
      create: { ...person, passwordHash },
    });
  }

  // Jashim's three-seat Bullet, set to his usual route.
  const jashim = await prisma.user.findUniqueOrThrow({
    where: { email: 'jashim@teslapool.test' },
  });
  const route = await prisma.route.findUniqueOrThrow({
    where: { code: JASHIM_ROUTE_CODE },
  });
  // The story starts at 8:41 AM on Banani Road 11.
  const banani = await prisma.zone.findUniqueOrThrow({
    where: { code: 'BAN' },
  });
  await prisma.vehicle.upsert({
    where: { driverId: jashim.id },
    update: { name: 'Bullet', seatCapacity: 3 },
    create: {
      driverId: jashim.id,
      name: 'Bullet',
      seatCapacity: 3,
      routeId: route.id,
      currentZoneId: banani.id,
    },
  });
  // An older database may have Bullet without a route or location; never overwrite his own.
  await prisma.vehicle.updateMany({
    where: { driverId: jashim.id, routeId: null },
    data: { routeId: route.id },
  });
  await prisma.vehicle.updateMany({
    where: { driverId: jashim.id, currentZoneId: null },
    data: { currentZoneId: banani.id },
  });
}
