import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import { RedisService } from '../redis/redis.service';

/**
 * Socket.IO adapter backed by Redis pub/sub so that events broadcast on one
 * node reach sockets connected to any other node (spec §3.1 horizontal scale).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor!: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisService: RedisService,
    private readonly corsOrigin: string[] | boolean,
  ) {
    super(app);
  }

  connectToRedis(): void {
    const pubClient = this.redisService.duplicate();
    const subClient = this.redisService.duplicate();
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis adapter initialized');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
