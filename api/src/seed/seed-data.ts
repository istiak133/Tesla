// Seed steps shared by the seed script and the e2e tests.
// Every step upserts by a natural key, so running it again changes nothing.
import { hashPassword } from '../auth/password.js';
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

export async function seedZones(prisma: PrismaClient): Promise<void> {
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
}

export async function seedCast(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const person of CAST) {
    await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, role: person.role },
      create: { ...person, passwordHash },
    });
  }
}
