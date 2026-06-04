import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RedisService } from './redis/redis.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

// BigInt (Message.seq, RoomMember.lastReadSeq) -> number on JSON.stringify.
// seq values stay well within Number.MAX_SAFE_INTEGER for this workload.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this as unknown as bigint);
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

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

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
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

  // Swagger / OpenAPI at /docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('인택톡(Intaktok) API')
    .setDescription('폐쇄형 실시간 채팅 플랫폼 백엔드 API (v2.0, E2EE 제외)')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, { swaggerOptions: { persistAuthorization: true } });

  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  // Bind to 0.0.0.0 so the container is reachable on PaaS (Railway, etc.).
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`Intaktok backend listening on :${port} (docs at /docs)`);
}

void bootstrap();
