// Configuration for the Prisma CLI (migrate, generate, studio).
// Prisma 7 does not read .env by itself, so dotenv loads it for local runs.
// In Docker and CI the variables come from the environment directly.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
