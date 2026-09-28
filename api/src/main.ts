import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './config/env.validation.js';

async function bootstrap() {
  // Buffer startup logs until the pino logger is ready, so every line is structured.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties that are not declared in the DTO
      forbidNonWhitelisted: true, // and reject the request if any were sent
      transform: true, // turn payloads into DTO class instances with real types
    }),
  );
  // Finish in-flight requests and close connections on SIGTERM (container stop, redeploy).
  app.enableShutdownHooks();

  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
