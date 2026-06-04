import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Presence tracked as a Redis SET of live socket ids per user (spec §7.5).
 * Multi-connection aware: a user is online while >= 1 socket is registered.
 * A TTL guards against crashed nodes; the gateway refreshes it via heartbeat.
 */
@Injectable()
export class PresenceService {
  private readonly ttlSec: number;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.ttlSec = this.config.get<number>('policy.presenceTtlSec')!;
  }

  private key(userId: string): string {
    return `presence:online:${userId}`;
  }

  get heartbeatTtl(): number {
    return this.ttlSec;
  }

  /** Register a socket. Returns true if this transitioned the user to online. */
  async addConnection(userId: string, socketId: string): Promise<boolean> {
    await this.redis.sadd(this.key(userId), socketId);
    await this.redis.expire(this.key(userId), this.ttlSec);
    const count = await this.redis.scard(this.key(userId));
    return count === 1;
  }

  /** Deregister a socket. Returns true if the user transitioned to offline. */
  async removeConnection(userId: string, socketId: string): Promise<boolean> {
    await this.redis.srem(this.key(userId), socketId);
    const count = await this.redis.scard(this.key(userId));
    if (count === 0) {
      await this.redis.del(this.key(userId));
      await this.prisma.user
        .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
      return true;
    }
    return false;
  }

  async refresh(userId: string): Promise<void> {
    await this.redis.expire(this.key(userId), this.ttlSec);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(this.key(userId))) > 0;
  }
}
