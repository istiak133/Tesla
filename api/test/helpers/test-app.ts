import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/database/prisma.service.js';

/** Starts the whole API the same way main.ts does, against the real test database. */
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

/** Deletes all rows so every test starts from an empty database. */
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
    'TRUNCATE TABLE "sessions", "users" RESTART IDENTITY CASCADE',
  );
}
