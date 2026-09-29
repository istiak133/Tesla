import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { EnvironmentVariables } from './config/env.validation.js';

/**
 * Everything the app needs besides its modules.
 * Used by main.ts and by the e2e tests, so tests run the same setup as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Requests arrive through the Next.js proxy (and the hosting platform's proxy).
  // Trusting the right number of hops gives the real client IP to rate limiting;
  // too few would put every user behind one shared limit.
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));

  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that are not declared in the DTO
      forbidNonWhitelisted: true, // and reject the request if any were sent
      transform: true, // turn payloads into DTO class instances with real types
    }),
  );
}
