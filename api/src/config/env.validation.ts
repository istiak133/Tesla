import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

/**
 * Every environment variable the API reads, with its type and default.
 * The app refuses to start if any value is invalid, so a misconfigured
 * deployment fails at boot instead of on the first request that needs it.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  // Required: there is no sensible default for where the database lives.
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL: string;

  // Free database plans allow few connections, so the pool stays small.
  @IsInt()
  @Min(1)
  @Max(50)
  DATABASE_POOL_MAX: number = 5;

  // How long a login lasts before the user has to sign in again.
  @IsInt()
  @Min(1)
  @Max(168)
  SESSION_TTL_HOURS: number = 12;

  // How many proxies sit in front of the API (Next.js proxy, hosting load balancer).
  // Used to find the real client IP for rate limiting. Set per deployment.
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 1;

  // The batching window (D-023): how often waiting requests are matched to running trips,
  // all at once. Longer gathers more requests per decision but makes riders wait longer.
  @IsInt()
  @Min(250)
  @Max(60_000)
  MATCH_INTERVAL_MS: number = 2_000;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return env;
}
