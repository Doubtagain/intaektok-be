import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Message, MessageType, Prisma, RoomType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Errors } from '../common/errors';
import { Paginated } from '../common/dto/pagination.dto';
import {
  DomainEvents,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageReadEvent,
  SerializedMessage,
} from '../common/events';
import { SystemMessagePayload } from './system-message';
import { messagePreview } from './preview';

export interface CreateMessageParams {
  roomId: string;
  senderId: string;
  type: MessageType;
  content?: string | null;
  mediaId?: string | null;
  replyToId?: string | null;
  clientMessageId?: string | null;
  /** Internal flag: skip membership/media validation for server-generated messages. */
  isSystem?: boolean;
}

export interface CreateMessageResult {
  message: SerializedMessage;
  /** True when an idempotent retry matched an existing message (no re-broadcast). */
  duplicate: boolean;
}

const MEDIA_TYPES = new Set<MessageType>([
  MessageType.IMAGE,
  MessageType.GIF,
  MessageType.VIDEO,
  MessageType.FILE,
]);

const SEQ_RETRY = 3;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly unsendWindowSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {
    this.unsendWindowSec = this.config.get<number>('policy.messageUnsendWindowSec')!;
  }

  // ---------------------------------------------------------------------------
  // Sequence issuance (Redis INCR with DB-backed initialization & recovery).
  // ---------------------------------------------------------------------------
  private seqKey(roomId: string): string {
    return `room:${roomId}:seq`;
  }

  private async dbMaxSeq(roomId: string): Promise<number> {
    const agg = await this.prisma.message.aggregate({
      where: { roomId },
      _max: { seq: true },
    });
    return agg._max.seq ? Number(agg._max.seq) : 0;
  }

  private async nextSeq(roomId: string): Promise<number> {
    const key = this.seqKey(roomId);
    if (!(await this.redis.exists(key))) {
      const max = await this.dbMaxSeq(roomId);
      await this.redis.setNx(key, max); // first writer wins; no-op if already set
    }
    return this.redis.incr(key);
  }

  private async resyncSeq(roomId: string): Promise<void> {
    const max = await this.dbMaxSeq(roomId);
    await this.redis.set(this.seqKey(roomId), max);
  }

  // ---------------------------------------------------------------------------
  // Core create — used by REST controller, WS gateway, and system messages.
  // (Single place where message bodies are persisted — see spec §12.3.)
  // ---------------------------------------------------------------------------
  async createMessage(params: CreateMessageParams): Promise<CreateMessageResult> {
    const { roomId, senderId, type } = params;

    // Idempotency: short-circuit on a previously persisted clientMessageId.
    if (params.clientMessageId) {
      const existing = await this.prisma.message.findUnique({
        where: { roomId_clientMessageId: { roomId, clientMessageId: params.clientMessageId } },
      });
      if (existing) return { message: this.serialize(existing), duplicate: true };
    }

    if (!params.isSystem) {
      await this.assertActiveMember(roomId, senderId);
      this.validatePayload(type, params.content, params.mediaId);
      if (params.mediaId) await this.assertOwnedMedia(params.mediaId, senderId);
      if (params.replyToId) await this.assertReplyTarget(roomId, params.replyToId);
    }

    const persisted = await this.persistWithSeq(params);

    // Idempotency race: a concurrent insert won the clientMessageId — return it.
    if (!persisted) {
      const existing = await this.prisma.message.findUnique({
        where: {
          roomId_clientMessageId: { roomId, clientMessageId: params.clientMessageId! },
        },
      });
      return { message: this.serialize(existing!), duplicate: true };
    }

    await this.prisma.room.update({
      where: { id: roomId },
      data: { lastMessageAt: persisted.createdAt },
    });

    const dto = this.serialize(persisted);
    await this.emitCreated(dto, params);
    return { message: dto, duplicate: false };
  }

  /** Insert with a freshly issued seq, retrying on seq collisions (Redis drift). */
  private async persistWithSeq(params: CreateMessageParams): Promise<Message | null> {
    for (let attempt = 0; attempt < SEQ_RETRY; attempt++) {
      const seq = await this.nextSeq(params.roomId);
      try {
        return await this.prisma.message.create({
          data: {
            roomId: params.roomId,
            senderId: params.senderId,
            seq: BigInt(seq),
            type: params.type,
            content: params.content ?? null,
            mediaId: params.mediaId ?? null,
            replyToId: params.replyToId ?? null,
            clientMessageId: params.clientMessageId ?? null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = (err.meta?.target as string[] | string | undefined) ?? '';
          const targetStr = Array.isArray(target) ? target.join(',') : target;
          if (targetStr.includes('clientMessageId')) {
            return null; // idempotency race — caller fetches the winner
          }
          if (targetStr.includes('seq')) {
            this.logger.warn(`seq collision in room ${params.roomId}, resyncing (attempt ${attempt})`);
            await this.resyncSeq(params.roomId);
            continue;
          }
        }
        throw err;
      }
    }
    throw Errors.conflict('메시지 시퀀스 발급에 실패했습니다.');
  }

  /** Helper for rooms module: persist a SYSTEM message and broadcast it. */
  async createSystemMessage(
    roomId: string,
    actorId: string,
    payload: SystemMessagePayload,
  ): Promise<SerializedMessage> {
    const res = await this.createMessage({
      roomId,
      senderId: actorId,
      type: MessageType.SYSTEM,
      content: JSON.stringify(payload),
      isSystem: true,
    });
    return res.message;
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  async listMessages(
    roomId: string,
    cursor: string | undefined,
    limit = 50,
  ): Promise<Paginated<SerializedMessage>> {
    const where: Prisma.MessageWhereInput = { roomId };
    if (cursor) {
      const c = Number(cursor);
      if (!Number.isFinite(c)) throw Errors.validation('cursor가 올바르지 않습니다.');
      where.seq = { lt: BigInt(c) };
    }

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // readCount: members (excluding the sender) whose lastReadSeq >= message.seq.
    const members = await this.prisma.roomMember.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true, lastReadSeq: true },
    });

    const items = page.map((m) => {
      const seqNum = Number(m.seq);
      const readCount = members.filter(
        (mem) => mem.userId !== m.senderId && Number(mem.lastReadSeq) >= seqNum,
      ).length;
      return { ...this.serialize(m), readCount };
    });

    return {
      items,
      nextCursor: hasMore ? String(Number(page[page.length - 1].seq)) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Read receipts
  // ---------------------------------------------------------------------------
  async markRead(roomId: string, userId: string, lastReadSeq: number): Promise<void> {
    // Only ever advance lastReadSeq (monotonic).
    const res = await this.prisma.roomMember.updateMany({
      where: { roomId, userId, leftAt: null, lastReadSeq: { lt: BigInt(lastReadSeq) } },
      data: { lastReadSeq: BigInt(lastReadSeq) },
    });
    if (res.count === 0) return; // no advance (already read or not a member)

    const memberUserIds = await this.getActiveMemberIds(roomId);
    const payload: MessageReadEvent = { roomId, userId, lastReadSeq, memberUserIds };
    this.events.emit(DomainEvents.MESSAGE_READ, payload);
  }

  /** Unread count for the room list: messages newer than my lastReadSeq, excluding my own & deleted. */
  async countUnread(roomId: string, userId: string, lastReadSeq: bigint): Promise<number> {
    return this.prisma.message.count({
      where: {
        roomId,
        seq: { gt: lastReadSeq },
        deletedAt: null,
        senderId: { not: userId },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Unsend (soft delete) — F14
  // ---------------------------------------------------------------------------
  async softDelete(roomId: string, messageId: string, requesterId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.roomId !== roomId) throw Errors.notFound('메시지를 찾을 수 없습니다.');
    if (message.type === MessageType.SYSTEM) throw Errors.forbidden();
    if (message.senderId !== requesterId) {
      throw Errors.forbidden('본인이 보낸 메시지만 삭제할 수 있습니다.');
    }
    if (message.deletedAt) return; // already unsent — idempotent

    const ageSec = (Date.now() - message.createdAt.getTime()) / 1000;
    if (ageSec > this.unsendWindowSec) {
      throw Errors.forbidden('삭제 가능 시간이 지났습니다.', {
        reason: 'UNSEND_WINDOW_EXPIRED',
        windowSec: this.unsendWindowSec,
      });
    }

    // True unsend: null out the body AND media reference, keep the placeholder row.
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: null, mediaId: null },
    });

    const memberUserIds = await this.getActiveMemberIds(roomId);
    const payload: MessageDeletedEvent = { roomId, messageId, memberUserIds };
    this.events.emit(DomainEvents.MESSAGE_DELETED, payload);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  async getActiveMemberIds(roomId: string): Promise<string[]> {
    const members = await this.prisma.roomMember.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  private async assertActiveMember(roomId: string, userId: string): Promise<void> {
    const m = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { leftAt: true },
    });
    if (!m || m.leftAt) throw Errors.forbidden('해당 채팅방의 멤버가 아닙니다.');
  }

  private validatePayload(type: MessageType, content?: string | null, mediaId?: string | null): void {
    if (type === MessageType.TEXT) {
      if (!content || !content.trim()) throw Errors.validation('본문이 비어 있습니다.');
    } else if (MEDIA_TYPES.has(type)) {
      if (!mediaId) throw Errors.validation('미디어 메시지에는 mediaId가 필요합니다.');
    } else {
      throw Errors.validation('허용되지 않은 메시지 타입입니다.');
    }
  }

  private async assertOwnedMedia(mediaId: string, senderId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { uploaderId: true },
    });
    if (!media) throw Errors.notFound('미디어를 찾을 수 없습니다.');
    if (media.uploaderId !== senderId) {
      throw Errors.forbidden('본인이 업로드한 미디어만 첨부할 수 있습니다.');
    }
  }

  private async assertReplyTarget(roomId: string, replyToId: string): Promise<void> {
    const target = await this.prisma.message.findUnique({
      where: { id: replyToId },
      select: { roomId: true },
    });
    if (!target || target.roomId !== roomId) {
      throw Errors.validation('답장 대상 메시지가 올바르지 않습니다.');
    }
  }

  private async emitCreated(dto: SerializedMessage, params: CreateMessageParams): Promise<void> {
    const [memberUserIds, room, senderProfile] = await Promise.all([
      this.getActiveMemberIds(params.roomId),
      this.prisma.room.findUnique({
        where: { id: params.roomId },
        select: { type: true, name: true },
      }),
      this.prisma.profile.findUnique({
        where: { userId: params.senderId },
        select: { nickname: true },
      }),
    ]);

    const preview = messagePreview(dto.type, dto.content);
    const roomTitle =
      room?.type === RoomType.GROUP ? (room?.name ?? '그룹 채팅') : (senderProfile?.nickname ?? '메시지');

    const payload: MessageCreatedEvent = { message: dto, memberUserIds, preview, roomTitle };
    this.events.emit(DomainEvents.MESSAGE_CREATED, payload);
  }

  /** Single serialization point. Deleted messages hide their body & media. */
  serialize(m: Message): SerializedMessage {
    const deleted = !!m.deletedAt;
    return {
      id: m.id,
      roomId: m.roomId,
      senderId: m.senderId,
      seq: Number(m.seq),
      type: m.type,
      content: deleted ? null : m.content,
      mediaId: deleted ? null : m.mediaId,
      replyToId: m.replyToId,
      clientMessageId: m.clientMessageId,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    };
  }
}
