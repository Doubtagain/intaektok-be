import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../presence/presence.service';
import { MessagesService } from '../messages/messages.service';
import { AppException } from '../common/errors';
import { AccessTokenPayload } from '../common/types';
import {
  DomainEvents,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageReadEvent,
  RoomLifecycleEvent,
  SessionRevokedEvent,
} from '../common/events';

interface SendPayload {
  clientMessageId?: string;
  roomId: string;
  type: any;
  content?: string | null;
  mediaId?: string | null;
  replyToId?: string | null;
}
interface ReadPayload {
  roomId: string;
  lastReadSeq: number;
}
interface DeletePayload {
  roomId: string;
  messageId: string;
}
interface TypingPayload {
  roomId: string;
}

type Ack = { ok: true; [k: string]: unknown } | { ok: false; error: { code: string; message: string } };

@WebSocketGateway({ path: '/ws', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly messages: MessagesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Connection lifecycle (auth + presence)
  // ---------------------------------------------------------------------------
  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = await this.authenticate(client);
      client.data.userId = userId;
      await client.join(this.userRoom(userId));

      // Spec §7.1: auto-join all of the user's active rooms on connect.
      const active = await this.prisma.roomMember.findMany({
        where: { userId, leftAt: null },
        select: { roomId: true },
      });
      if (active.length) await client.join(active.map((r) => r.roomId));

      const becameOnline = await this.presence.addConnection(userId, client.id);

      // Refresh presence TTL periodically while connected (heartbeat).
      const interval = setInterval(
        () =>
          void this.presence
            .refresh(userId)
            .catch((err) =>
              this.logger.debug(`presence refresh failed for ${userId}: ${(err as Error).message}`),
            ),
        Math.max(1, Math.floor(this.presence.heartbeatTtl / 2)) * 1000,
      );
      client.data.heartbeat = interval;

      if (becameOnline) {
        await this.broadcastPresence(userId, 'online');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '인증에 실패했습니다.';
      client.emit('error', { code: 'UNAUTHORIZED', message });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    if (client.data.heartbeat) clearInterval(client.data.heartbeat as NodeJS.Timeout);
    const userId: string | undefined = client.data.userId;
    if (!userId) return;
    const becameOffline = await this.presence.removeConnection(userId, client.id);
    if (becameOffline) {
      await this.broadcastPresence(userId, 'offline');
    }
  }

  private async authenticate(client: Socket): Promise<string> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      this.bearerFromHeader(client.handshake.headers?.authorization);
    if (!token) throw new Error('토큰이 없습니다.');

    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get<string>('jwt.accessSecret')!,
    });
    if (payload.type !== 'access') throw new Error('잘못된 토큰 타입입니다.');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new Error('비활성화된 계정입니다.');
    return payload.sub;
  }

  private bearerFromHeader(header?: string): string | undefined {
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' ? value : undefined;
  }

  // ---------------------------------------------------------------------------
  // Client -> Server
  // ---------------------------------------------------------------------------
  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SendPayload,
  ): Promise<Ack> {
    const userId = client.data.userId as string;
    try {
      const { message } = await this.messages.createMessage({
        roomId: body.roomId,
        senderId: userId,
        type: body.type,
        content: body.content,
        mediaId: body.mediaId,
        replyToId: body.replyToId,
        clientMessageId: body.clientMessageId,
      });
      return { ok: true, id: message.id, seq: message.seq, createdAt: message.createdAt };
    } catch (err) {
      return this.errAck(err);
    }
  }

  @SubscribeMessage('message:read')
  async onRead(@ConnectedSocket() client: Socket, @MessageBody() body: ReadPayload): Promise<Ack> {
    const userId = client.data.userId as string;
    try {
      await this.messages.markRead(body.roomId, userId, Number(body.lastReadSeq));
      return { ok: true };
    } catch (err) {
      return this.errAck(err);
    }
  }

  @SubscribeMessage('message:delete')
  async onDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: DeletePayload,
  ): Promise<Ack> {
    const userId = client.data.userId as string;
    try {
      await this.messages.softDelete(body.roomId, body.messageId, userId);
      return { ok: true };
    } catch (err) {
      return this.errAck(err);
    }
  }

  @SubscribeMessage('typing:start')
  async onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: TypingPayload,
  ): Promise<void> {
    await this.relayTyping(client, body.roomId, true);
  }

  @SubscribeMessage('typing:stop')
  async onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: TypingPayload,
  ): Promise<void> {
    await this.relayTyping(client, body.roomId, false);
  }

  @SubscribeMessage('room:join')
  async onRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string },
  ): Promise<Ack> {
    const userId = client.data.userId as string;
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: body.roomId, userId } },
      select: { leftAt: true },
    });
    if (!member || member.leftAt) {
      return { ok: false, error: { code: 'FORBIDDEN', message: '방 멤버가 아닙니다.' } };
    }
    await client.join(body.roomId);
    return { ok: true, roomId: body.roomId };
  }

  // ---------------------------------------------------------------------------
  // Domain events -> Server -> Client (the single broadcaster)
  // ---------------------------------------------------------------------------
  @OnEvent(DomainEvents.MESSAGE_CREATED)
  onMessageCreated(payload: MessageCreatedEvent): void {
    this.emitToUsers(payload.memberUserIds, 'message:new', payload.message);
  }

  @OnEvent(DomainEvents.MESSAGE_READ)
  onMessageRead(payload: MessageReadEvent): void {
    this.emitToUsers(payload.memberUserIds, 'message:read', {
      roomId: payload.roomId,
      userId: payload.userId,
      lastReadSeq: payload.lastReadSeq,
    });
  }

  @OnEvent(DomainEvents.MESSAGE_DELETED)
  onMessageDeleted(payload: MessageDeletedEvent): void {
    this.emitToUsers(payload.memberUserIds, 'message:deleted', {
      roomId: payload.roomId,
      messageId: payload.messageId,
    });
  }

  @OnEvent(DomainEvents.ROOM_CREATED)
  onRoomCreated(payload: RoomLifecycleEvent): void {
    this.emitToUsers(payload.memberUserIds, 'room:created', { room: payload.room });
  }

  @OnEvent(DomainEvents.ROOM_UPDATED)
  onRoomUpdated(payload: RoomLifecycleEvent): void {
    this.emitToUsers(payload.memberUserIds, 'room:updated', { room: payload.room });
  }

  @OnEvent(DomainEvents.SESSION_REVOKED)
  onSessionRevoked(payload: SessionRevokedEvent): void {
    this.server.in(this.userRoom(payload.userId)).disconnectSockets(true);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  /**
   * Deliver to a set of users by their personal rooms. Socket.IO de-duplicates
   * across the room union, and the Redis adapter routes to the right node — so
   * delivery does not depend on per-room socket joins.
   */
  private emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!userIds.length) return;
    this.server.to(userIds.map((u) => this.userRoom(u))).emit(event, payload);
  }

  private async relayTyping(client: Socket, roomId: string, isTyping: boolean): Promise<void> {
    const userId = client.data.userId as string;
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { leftAt: true },
    });
    if (!member || member.leftAt) return;

    const recipients = (await this.messages.getActiveMemberIds(roomId)).filter((u) => u !== userId);
    this.emitToUsers(recipients, 'typing', { roomId, userId, isTyping });
  }

  private async broadcastPresence(userId: string, status: 'online' | 'offline'): Promise<void> {
    const coMembers = await this.coMemberIds(userId);
    const payload =
      status === 'offline' ? { userId, status, lastSeenAt: new Date().toISOString() } : { userId, status };
    this.emitToUsers(coMembers, 'presence', payload);
  }

  private async coMemberIds(userId: string): Promise<string[]> {
    const myRooms = await this.prisma.roomMember.findMany({
      where: { userId, leftAt: null },
      select: { roomId: true },
    });
    const roomIds = myRooms.map((r) => r.roomId);
    if (!roomIds.length) return [];
    const members = await this.prisma.roomMember.findMany({
      where: { roomId: { in: roomIds }, leftAt: null, userId: { not: userId } },
      select: { userId: true },
    });
    return [...new Set(members.map((m) => m.userId))];
  }

  private errAck(err: unknown): Ack {
    if (err instanceof AppException) {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    this.logger.error(`WS handler error: ${(err as Error)?.message}`);
    return { ok: false, error: { code: 'INTERNAL', message: '처리 중 오류가 발생했습니다.' } };
  }
}
