import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly extras: Redis[] = [];

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    const url = this.config.get<string>('redisUrl')!;
    this.client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    this.client.on('connect', () => this.logger.log('Redis connected'));
  }

  /** Raw ioredis client for advanced use. */
  get raw(): Redis {
    return this.client;
  }

  /** Create an independent connection (used for Socket.IO redis-adapter pub/sub). */
  duplicate(): Redis {
    const dup = this.client.duplicate();
    dup.on('error', (err) => this.logger.error(`Redis(dup) error: ${err.message}`));
    this.extras.push(dup);
    return dup;
  }

  // --- generic helpers ---
  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string | number, ttlSec?: number): Promise<void> {
    if (ttlSec) await this.client.set(key, value, 'EX', ttlSec);
    else await this.client.set(key, value);
  }

  /** SET only if not exists. Returns true if it was set. */
  async setNx(key: string, value: string | number): Promise<boolean> {
    const res = await this.client.set(key, value, 'NX');
    return res === 'OK';
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    await this.client.expire(key, ttlSec);
  }

  async sadd(key: string, member: string): Promise<number> {
    return this.client.sadd(key, member);
  }

  async srem(key: string, member: string): Promise<number> {
    return this.client.srem(key, member);
  }

  scard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  /** Delete every key matching a glob pattern (safe SCAN-based). */
  async delByPattern(pattern: string): Promise<void> {
    const stream = this.client.scanStream({ match: pattern, count: 100 });
    const pipeline = this.client.pipeline();
    let found = 0;
    for await (const keys of stream) {
      for (const key of keys as string[]) {
        pipeline.del(key);
        found++;
      }
    }
    if (found) await pipeline.exec();
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.client.quit(),
      ...this.extras.map((c) => c.quit()),
    ]);
  }
}
