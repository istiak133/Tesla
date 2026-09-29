import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { EnvironmentVariables } from './config/env.validation.js';

async function bootstrap() {
  // Buffer startup logs until the pino logger is ready, so every line is structured.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  configureApp(app);

  // Finish in-flight requests and close connections on SIGTERM (container stop, redeploy).
  app.enableShutdownHooks();

  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
