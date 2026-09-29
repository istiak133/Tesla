import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import {
  EnvironmentVariables,
  NodeEnv,
  validateEnv,
} from './config/env.validation.js';
import { buildLoggerParams } from './config/logger.config.js';
import { DatabaseModule } from './database/database.module.js';
import { GeographyModule } from './geography/geography.module.js';
import { HealthModule } from './health/health.module.js';
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
    // Skipped in tests, which log in many times in a row.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: [{ limit: 100, ttl: 60_000 }],
        skipIf: () => config.get('NODE_ENV', { infer: true }) === NodeEnv.Test,
      }),
    }),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    GeographyModule,
  ],
})
export class AppModule {}
