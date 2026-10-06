// Demo data: the 14 Dhaka zones, their distances and the Tesla routes, and the PRD's story cast.
// Safe to run many times (everything is upserted; an existing route's stops are never rewritten).
//
// Run:  npm run build && npm run db:seed
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { seedCast, seedGeography } from './seed-data.js';

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const { routesLeftAsTheyAre } = await seedGeography(prisma);
    console.log('seeded zones, distances and routes');
    if (routesLeftAsTheyAre.length > 0) {
      console.warn(
        `route stops in the code differ from the database, left as they are: ${routesLeftAsTheyAre.join(', ')}. ` +
          'Trips store stop positions, so change a route with a new route code and a data migration.',
      );
    }
    await seedCast(prisma);
    console.log('seeded the story cast');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
