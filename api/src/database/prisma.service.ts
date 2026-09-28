import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The single database client for the whole API.
 * Only repositories use it; services and controllers never talk to the database directly.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: config.get('DATABASE_POOL_MAX', { infer: true }),
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    // With a driver adapter, $connect() does not open a connection by itself,
    // so run one real query: a wrong DATABASE_URL or a down database
    // stops the app at startup instead of failing on the first request.
    await this.$connect();
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
