import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { Errors } from '../common/errors';
import { DomainEvents, MessageCreatedEvent } from '../common/events';
import { FcmService } from './fcm.service';
import { RegisterTokenDto } from './dto/push.dto';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly fcm: FcmService,
  ) {}

  async registerToken(userId: string, dto: RegisterTokenDto) {
    // fcmToken is globally unique — re-register reassigns it to this user/device.
    const token = await this.prisma.pushToken.upsert({
      where: { fcmToken: dto.fcmToken },
      create: {
        userId,
        fcmToken: dto.fcmToken,
        platform: dto.platform,
        deviceId: dto.deviceId ?? null,
      },
      update: { userId, platform: dto.platform, deviceId: dto.deviceId ?? null },
    });
    return { id: token.id, platform: token.platform };
  }

  async removeToken(userId: string, tokenId: string): Promise<void> {
    const res = await this.prisma.pushToken.deleteMany({ where: { id: tokenId, userId } });
    if (res.count === 0) throw Errors.notFound('푸시 토큰을 찾을 수 없습니다.');
  }

  /**
   * F11: push to offline recipients of a new message. Skips the sender, online
   * users, muted memberships, and SYSTEM messages.
   */
  @OnEvent(DomainEvents.MESSAGE_CREATED)
  async onMessageCreated(event: MessageCreatedEvent): Promise<void> {
    try {
      const { message } = event;
      if (message.type === MessageType.SYSTEM) return;

      const recipientIds = event.memberUserIds.filter((id) => id !== message.senderId);
      if (!recipientIds.length) return;

      // Offline filter (presence) — only push to users not currently connected.
      const onlineFlags = await Promise.all(recipientIds.map((id) => this.presence.isOnline(id)));
      const offline = recipientIds.filter((_, i) => !onlineFlags[i]);
      if (!offline.length) return;

      // Drop muted memberships.
      const now = new Date();
      const muted = await this.prisma.roomMember.findMany({
        where: { roomId: message.roomId, userId: { in: offline }, mutedUntil: { gt: now } },
        select: { userId: true },
      });
      const mutedSet = new Set(muted.map((m) => m.userId));
      const targets = offline.filter((id) => !mutedSet.has(id));
      if (!targets.length) return;

      const tokens = await this.prisma.pushToken.findMany({
        where: { userId: { in: targets } },
        select: { fcmToken: true },
      });
      if (!tokens.length) return;

      const { invalidTokens } = await this.fcm.sendToTokens(
        tokens.map((t) => t.fcmToken),
        { title: event.roomTitle, body: event.preview },
        { roomId: message.roomId, messageId: message.id, type: String(message.type) },
      );

      if (invalidTokens.length) {
        await this.prisma.pushToken.deleteMany({ where: { fcmToken: { in: invalidTokens } } });
      }
    } catch (err) {
      this.logger.error(`push onMessageCreated failed: ${(err as Error).message}`);
    }
  }
}
