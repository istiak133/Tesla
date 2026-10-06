import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
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
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: config.get('DATABASE_POOL_MAX', { infer: true }),
      // Give up after 5 seconds instead of waiting forever for a stuck database.
      connectionTimeoutMillis: 5000,
      // No single query may run for ever: the server stops it after 10 s (longer than any
      // real query here; a transaction's own limit is 10 s too), and the client gives up after
      // 15 s even if the connection went quiet (a half-open TCP connection never answers).
      // Without this, a hung query would leave the matcher's round "running" for good.
      statement_timeout: 10_000,
      query_timeout: 15_000,
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

  // The last shutdown step: Nest runs it after the HTTP server has closed, so requests still
  // in flight on SIGTERM finish against a working pool (onModuleDestroy runs before that).
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
