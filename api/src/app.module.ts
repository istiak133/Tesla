import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { accountKey, clientIp } from './auth/client-ip.js';
import {
  EnvironmentVariables,
  NodeEnv,
  validateEnv,
} from './config/env.validation.js';
import { buildLoggerParams } from './config/logger.config.js';
import { DatabaseModule } from './database/database.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { HealthModule } from './health/health.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RidesModule } from './rides/rides.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        buildLoggerParams(
          config.get('NODE_ENV', { infer: true }),
          config.get('LOG_LEVEL', { infer: true }),
        ),
    }),
    // Rate limiting. The actual limits are set per route with @Throttle.
    // Skipped in tests, which log in many times in a row, except in the test of the limit
    // itself (RATE_LIMIT_IN_TESTS, read per request so that test can turn it on).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: [
          // Count by the real client, not the proxy in front of us (see client-ip.ts).
          { name: 'default', limit: 100, ttl: 60_000 },
          // Count by the account tried, so a faked address cannot get around the limit.
          {
            name: 'account',
            limit: 100,
            ttl: 60_000,
            getTracker: (request) => accountKey(request as Request),
          },
        ],
        getTracker: (request) => clientIp(request as Request),
        skipIf: () =>
          config.get('NODE_ENV', { infer: true }) === NodeEnv.Test &&
          process.env.RATE_LIMIT_IN_TESTS !== 'true',
      }),
    }),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    GeographyModule,
    RealtimeModule,
    RidesModule,
  ],
})
export class AppModule {}
