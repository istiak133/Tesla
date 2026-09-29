// Demo data with the PRD's story cast. Safe to run many times:
// every record is upserted by a natural key, so nothing is duplicated.
//
// Run:  npm run build && npm run db:seed
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../auth/password.js';
import { PrismaClient, Role } from '../generated/prisma/client.js';

// Shared demo password, listed in the README. For local and demo use only.
const DEMO_PASSWORD = 'tesla1234';

const CAST = [
  { name: 'Jashim', email: 'jashim@teslapool.test', role: Role.DRIVER },
  { name: 'Nusrat', email: 'nusrat@teslapool.test', role: Role.PASSENGER },
  { name: 'Rafiq', email: 'rafiq@teslapool.test', role: Role.PASSENGER },
  { name: 'Shirin', email: 'shirin@teslapool.test', role: Role.PASSENGER },
];

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    for (const person of CAST) {
      await prisma.user.upsert({
        where: { email: person.email },
        update: { name: person.name, role: person.role },
        create: { ...person, passwordHash },
      });
      console.log(`seeded user ${person.name} (${person.role})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
