import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { PresenceModule } from './presence/presence.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProfileModule } from './profile/profile.module';
import { RoomsModule } from './rooms/rooms.module';
import { MessagesModule } from './messages/messages.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MediaModule } from './media/media.module';
import { PushModule } from './push/push.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('nodeEnv') === 'production' ? 'info' : 'debug',
          transport:
            config.get('nodeEnv') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
          // Never log message bodies / auth headers (spec §8.5 / §11).
          redact: {
            paths: [
              'req.headers.authorization',
              'req.body.content',
              'req.body.code',
              'req.body.refreshToken',
            ],
            remove: true,
          },
          autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    JwtModule.register({ global: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: (config.get<number>('throttle.ttl') ?? 60) * 1000,
          limit: config.get<number>('throttle.limit') ?? 120,
        },
      ],
    }),

    PrismaModule,
    RedisModule,
    PresenceModule,

    AuthModule,
    UsersModule,
    ProfileModule,
    RoomsModule,
    MessagesModule,
    RealtimeModule,
    MediaModule,
    PushModule,
    AdminModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
