import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { EnvironmentVariables } from './config/env.validation.js';
import { jsonBodiesOnly } from './json-bodies-only.js';
import { RideErrorFilter } from './rides/ride-error.filter.js';

/**
 * Everything the app needs besides its modules.
 * Used by main.ts and by the e2e tests, so tests run the same setup as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Requests arrive through the Next.js proxy (and the hosting platform's proxy). This sets
  // Express `trust proxy`, which decides `req.ip`. Rate limiting does not use it: it counts
  // by the first X-Forwarded-For entry and by account (auth/client-ip.ts, D-013).
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));

  app.use(helmet());
  // JSON bodies only, checked before the body parsers run (no form posts from other sites).
  app.use(jsonBodiesOnly);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that are not declared in the DTO
      forbidNonWhitelisted: true, // and reject the request if any were sent
      transform: true, // turn payloads into DTO class instances with real types
    }),
  );
  // Business errors from the ride services become 4xx responses with a code.
  app.useGlobalFilters(new RideErrorFilter());
}
