import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RedisService } from './redis/redis.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { GLOBAL_API_PREFIX, GLOBAL_PREFIX_EXCLUDE } from './global-prefix';
import { buildOpenApiDocument } from './swagger';

// BigInt (Message.seq, RoomMember.lastReadSeq) -> number on JSON.stringify.
// seq values stay well within Number.MAX_SAFE_INTEGER for this workload.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this as unknown as bigint);
};

async function bootstrap(): Promise<void> {
  // Visible immediately in deploy logs, before any (buffered) Nest logger exists.
  // eslint-disable-next-line no-console
  console.log(
    `[bootstrap] Intaktok backend starting (node ${process.version}, NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
  );

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Reject instead of exiting inside Nest so the catch below can print the
    // real cause — with the default (true) + bufferLogs, init errors die silently.
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get(ConfigService);
  const isProd = config.get<string>('nodeEnv') === 'production';
  const corsOrigins = config.get<string[]>('cors.origins') ?? [];
  // Fail-safe: in production an empty CORS_ORIGINS denies cross-origin browser
  // requests (mobile/native clients are unaffected). In dev, allow all.
  const corsOrigin: string[] | boolean = corsOrigins.length ? corsOrigins : !isProd;
  if (isProd && !corsOrigins.length) {
    app.get(Logger).warn('CORS_ORIGINS is empty in production — cross-origin browser requests are blocked.');
  }

  app.use(helmet());
  app.enableCors({ origin: corsOrigin, credentials: true });

  app.setGlobalPrefix(GLOBAL_API_PREFIX, { exclude: GLOBAL_PREFIX_EXCLUDE });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Socket.IO with Redis adapter (cross-node broadcast).
  const ioAdapter = new RedisIoAdapter(app, app.get(RedisService), corsOrigin);
  ioAdapter.connectToRedis();
  app.useWebSocketAdapter(ioAdapter);

  // OpenAPI document — shared by Swagger UI, Scalar, and the raw JSON/YAML routes.
  const document = buildOpenApiDocument(app);
  // Classic Swagger UI + raw spec at /docs, /docs-json, /docs-yaml.
  SwaggerModule.setup('docs', app, document, { swaggerOptions: { persistAuthorization: true } });
  // Modern, more readable reference UI at /openapi-docs (frontend-facing).
  app.use(
    '/openapi-docs',
    apiReference({
      content: document,
      theme: 'purple',
      // Pre-fill the auth modal so "Authorize" is one paste away.
      authentication: { preferredSecurityScheme: 'bearer' },
    }),
  );

  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  // Bind to 0.0.0.0 so the container is reachable on PaaS (Railway, etc.).
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`Intaktok backend listening on :${port} (docs: /docs, /openapi-docs)`);
}

// Fail loudly: startup crashes must reach stderr (deploy logs), bypassing any
// buffered/structured logger that may not have been attached yet.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] Unhandled promise rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] Uncaught exception:', err);
  process.exit(1);
});

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] Bootstrap failed:', err);
  process.exit(1);
});
