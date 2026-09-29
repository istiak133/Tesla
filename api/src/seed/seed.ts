// Demo data: the 14 Dhaka zones, their distances and the Tesla routes, and the PRD's story cast.
// Safe to run many times (everything is upserted).
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
    await seedGeography(prisma);
    console.log('seeded zones, distances and routes');
    await seedCast(prisma);
    console.log('seeded the story cast');
  } finally {
    await prisma.$disconnect();
  }
}

await main();
