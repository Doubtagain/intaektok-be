import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MemberRole, Prisma, Room, RoomType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { MessagesService } from '../messages/messages.service';
import { messagePreview } from '../messages/preview';
import { Errors } from '../common/errors';
import { Paginated } from '../common/dto/pagination.dto';
import { DomainEvents, RoomLifecycleEvent } from '../common/events';
import { AddMembersDto, CreateRoomDto, UpdateMemberRoleDto, UpdateRoomDto } from './dto/room.dto';

export interface MemberView {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export interface RoomView {
  id: string;
  type: RoomType;
  name: string | null;
  avatarUrl: string | null;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string | null;
  members: MemberView[];
  lastMessage?: {
    seq: number;
    type: string;
    preview: string;
    createdAt: string;
  } | null;
  unreadCount?: number;
}

type RoomWithMembers = Prisma.RoomGetPayload<{
  include: {
    members: { include: { user: { include: { profile: true } } } };
    messages: true;
  };
}>;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly media: MediaService,
    private readonly events: EventEmitter2,
  ) {}

  private directKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  private async assertActiveUsers(userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds)];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (users.length !== ids.length) {
      const found = new Set(users.map((u) => u.id));
      throw Errors.forbidden('등록되지 않았거나 비활성화된 사용자가 포함되어 있습니다.', {
        invalid: ids.filter((id) => !found.has(id)),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Create (1:1 with dedup, or group)
  // ---------------------------------------------------------------------------
  async createRoom(creatorId: string, dto: CreateRoomDto): Promise<RoomView> {
    if (dto.type === RoomType.DIRECT) {
      return this.createDirect(creatorId, dto);
    }
    return this.createGroup(creatorId, dto);
  }

  private async createDirect(creatorId: string, dto: CreateRoomDto): Promise<RoomView> {
    if (dto.memberUserIds.length !== 1) {
      throw Errors.validation('1:1 방은 상대 1명을 지정해야 합니다.');
    }
    const otherId = dto.memberUserIds[0];
    if (otherId === creatorId) throw Errors.validation('자기 자신과는 방을 만들 수 없습니다.');
    await this.assertActiveUsers([creatorId, otherId]);

    const key = this.directKey(creatorId, otherId);
    const existing = await this.prisma.room.findUnique({ where: { directKey: key } });
    if (existing) {
      return this.reactivateDirect(existing.id, creatorId, otherId);
    }

    let roomId: string;
    try {
      const room = await this.prisma.room.create({
        data: {
          type: RoomType.DIRECT,
          createdBy: creatorId,
          directKey: key,
          members: {
            create: [
              { userId: creatorId, role: MemberRole.MEMBER },
              { userId: otherId, role: MemberRole.MEMBER },
            ],
          },
        },
      });
      roomId = room.id;
    } catch (err) {
      // TOCTOU: a concurrent request created the same pair first — return the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.room.findUnique({ where: { directKey: key } });
        if (winner) return this.reactivateDirect(winner.id, creatorId, otherId);
      }
      throw err;
    }

    const view = await this.getRoomView(roomId, creatorId);
    await this.emitLifecycle(DomainEvents.ROOM_CREATED, roomId, [creatorId, otherId]);
    return view;
  }

  /** Re-activate either side that had left an existing 1:1 room, then return it. */
  private async reactivateDirect(
    roomId: string,
    creatorId: string,
    otherId: string,
  ): Promise<RoomView> {
    await this.prisma.roomMember.updateMany({
      where: { roomId, userId: { in: [creatorId, otherId] }, leftAt: { not: null } },
      data: { leftAt: null },
    });
    return this.getRoomView(roomId, creatorId);
  }

  private async createGroup(creatorId: string, dto: CreateRoomDto): Promise<RoomView> {
    const memberIds = [...new Set([creatorId, ...dto.memberUserIds])];
    await this.assertActiveUsers(memberIds);
    await this.media.assertOwnedMediaOrNull(dto.avatarMediaId, creatorId);

    const room = await this.prisma.room.create({
      data: {
        type: RoomType.GROUP,
        name: dto.name ?? null,
        avatarMediaId: dto.avatarMediaId ?? null,
        createdBy: creatorId,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            role: userId === creatorId ? MemberRole.OWNER : MemberRole.MEMBER,
          })),
        },
      },
    });

    await this.emitLifecycle(DomainEvents.ROOM_CREATED, room.id, memberIds);
    await this.messages.createSystemMessage(room.id, creatorId, {
      code: 'ROOM_CREATED',
      actorId: creatorId,
    });
    return this.getRoomView(room.id, creatorId);
  }

  // ---------------------------------------------------------------------------
  // List / detail
  // ---------------------------------------------------------------------------
  async listRooms(
    userId: string,
    cursor: string | undefined,
    limit = 30,
  ): Promise<Paginated<RoomView>> {
    const cursorDate = cursor ? new Date(cursor) : null;
    const memberships = await this.prisma.roomMember.findMany({
      where: {
        userId,
        leftAt: null,
        ...(cursorDate ? { room: { lastMessageAt: { lt: cursorDate } } } : {}),
      },
      include: {
        room: {
          include: {
            members: {
              where: { leftAt: null },
              include: { user: { include: { profile: true } } },
            },
            messages: { orderBy: { seq: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { room: { lastMessageAt: { sort: 'desc', nulls: 'last' } } },
      take: limit + 1,
    });

    const hasMore = memberships.length > limit;
    const page = hasMore ? memberships.slice(0, limit) : memberships;

    const avatarMap = await this.collectAvatars(page.map((m) => m.room));
    const items = await Promise.all(
      page.map(async (m) => {
        const unreadCount = await this.messages.countUnread(m.roomId, userId, m.lastReadSeq);
        return this.buildView(m.room, avatarMap, { unreadCount, includeLastMessage: true });
      }),
    );

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last?.room.lastMessageAt ? last.room.lastMessageAt.toISOString() : null;
    return { items, nextCursor };
  }

  /** Detail view used by GET /rooms/:id and after mutations. */
  async getRoomView(roomId: string, requesterId: string): Promise<RoomView> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: { where: { leftAt: null }, include: { user: { include: { profile: true } } } },
        messages: { orderBy: { seq: 'desc' }, take: 1 },
      },
    });
    if (!room) throw Errors.notFound('채팅방을 찾을 수 없습니다.');

    const membership = room.members.find((mem) => mem.userId === requesterId);
    const avatarMap = await this.collectAvatars([room]);
    const unreadCount = membership
      ? await this.messages.countUnread(roomId, requesterId, membership.lastReadSeq)
      : 0;
    return this.buildView(room, avatarMap, { unreadCount, includeLastMessage: true });
  }

  // ---------------------------------------------------------------------------
  // Group management
  // ---------------------------------------------------------------------------
  async updateRoom(
    roomId: string,
    actorId: string,
    actorRole: MemberRole,
    dto: UpdateRoomDto,
  ): Promise<RoomView> {
    const room = await this.requireGroup(roomId);
    this.requireRole(actorRole, [MemberRole.OWNER, MemberRole.ADMIN]);
    await this.media.assertOwnedMediaOrNull(dto.avatarMediaId, actorId);

    await this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.avatarMediaId !== undefined ? { avatarMediaId: dto.avatarMediaId } : {}),
      },
    });

    if (dto.name !== undefined && dto.name !== room.name) {
      await this.messages.createSystemMessage(roomId, actorId, {
        code: 'ROOM_RENAMED',
        actorId,
        name: dto.name,
      });
    }
    if (dto.avatarMediaId !== undefined) {
      await this.messages.createSystemMessage(roomId, actorId, {
        code: 'ROOM_AVATAR_CHANGED',
        actorId,
      });
    }

    await this.emitLifecycle(
      DomainEvents.ROOM_UPDATED,
      roomId,
      await this.messages.getActiveMemberIds(roomId),
    );
    return this.getRoomView(roomId, actorId);
  }

  async addMembers(
    roomId: string,
    actorId: string,
    actorRole: MemberRole,
    dto: AddMembersDto,
  ): Promise<RoomView> {
    await this.requireGroup(roomId);
    this.requireRole(actorRole, [MemberRole.OWNER, MemberRole.ADMIN]);
    await this.assertActiveUsers(dto.userIds);

    // New members start "read" at the current head so history isn't all unread.
    const maxSeq = await this.prisma.message.aggregate({
      where: { roomId },
      _max: { seq: true },
    });
    const head = maxSeq._max.seq ?? BigInt(0);

    const existing = await this.prisma.roomMember.findMany({
      where: { roomId, userId: { in: dto.userIds } },
    });
    const existingMap = new Map(existing.map((m) => [m.userId, m]));
    const actuallyAdded: string[] = [];

    for (const userId of [...new Set(dto.userIds)]) {
      const prev = existingMap.get(userId);
      if (prev && !prev.leftAt) continue; // already an active member
      if (prev) {
        await this.prisma.roomMember.update({
          where: { roomId_userId: { roomId, userId } },
          data: { leftAt: null, role: MemberRole.MEMBER, joinedAt: new Date(), lastReadSeq: head },
        });
      } else {
        await this.prisma.roomMember.create({
          data: { roomId, userId, role: MemberRole.MEMBER, lastReadSeq: head },
        });
      }
      actuallyAdded.push(userId);
    }

    if (actuallyAdded.length) {
      await this.emitLifecycle(
        DomainEvents.ROOM_UPDATED,
        roomId,
        await this.messages.getActiveMemberIds(roomId),
      );
      await this.messages.createSystemMessage(roomId, actorId, {
        code: 'MEMBER_JOINED',
        actorId,
        targetIds: actuallyAdded,
      });
    }
    return this.getRoomView(roomId, actorId);
  }

  async updateMemberRole(
    roomId: string,
    actorId: string,
    actorRole: MemberRole,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<RoomView> {
    await this.requireGroup(roomId);
    this.requireRole(actorRole, [MemberRole.OWNER]);

    const target = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
    });
    if (!target || target.leftAt) throw Errors.notFound('대상 멤버를 찾을 수 없습니다.');
    if (targetUserId === actorId) throw Errors.validation('본인 권한은 변경할 수 없습니다.');

    await this.prisma.$transaction(async (tx) => {
      await tx.roomMember.update({
        where: { roomId_userId: { roomId, userId: targetUserId } },
        data: { role: dto.role },
      });
      // Ownership is singular: transferring OWNER demotes the previous owner.
      if (dto.role === MemberRole.OWNER) {
        await tx.roomMember.update({
          where: { roomId_userId: { roomId, userId: actorId } },
          data: { role: MemberRole.ADMIN },
        });
      }
    });

    await this.messages.createSystemMessage(roomId, actorId, {
      code: 'ROLE_CHANGED',
      actorId,
      targetId: targetUserId,
      role: dto.role,
    });
    await this.emitLifecycle(
      DomainEvents.ROOM_UPDATED,
      roomId,
      await this.messages.getActiveMemberIds(roomId),
    );
    return this.getRoomView(roomId, actorId);
  }

  async removeMember(
    roomId: string,
    actorId: string,
    actorRole: MemberRole,
    targetUserId: string,
  ): Promise<void> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw Errors.notFound('채팅방을 찾을 수 없습니다.');

    const target = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
    });
    if (!target || target.leftAt) throw Errors.notFound('대상 멤버를 찾을 수 없습니다.');

    const isSelf = targetUserId === actorId;
    if (!isSelf) {
      // Kicking someone else requires OWNER/ADMIN and proper rank.
      if (actorRole === MemberRole.MEMBER) throw Errors.forbidden('멤버를 내보낼 권한이 없습니다.');
      if (target.role === MemberRole.OWNER) throw Errors.forbidden('소유자는 내보낼 수 없습니다.');
      if (actorRole === MemberRole.ADMIN && target.role === MemberRole.ADMIN) {
        throw Errors.forbidden('관리자는 다른 관리자를 내보낼 수 없습니다.');
      }
    }

    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId: targetUserId } },
      data: { leftAt: new Date() },
    });

    // If an OWNER leaves a group, hand ownership to the next-most-senior member.
    if (target.role === MemberRole.OWNER && room.type === RoomType.GROUP) {
      await this.transferOwnership(roomId);
    }

    // System message + lifecycle (DIRECT leaves are silent — no system noise).
    if (room.type === RoomType.GROUP) {
      await this.messages.createSystemMessage(
        roomId,
        actorId,
        isSelf
          ? { code: 'MEMBER_LEFT', actorId }
          : { code: 'MEMBER_KICKED', actorId, targetId: targetUserId },
      );
    }

    const active = await this.messages.getActiveMemberIds(roomId);
    await this.emitLifecycle(DomainEvents.ROOM_UPDATED, roomId, [
      ...new Set([...active, targetUserId]),
    ]);
  }

  private async transferOwnership(roomId: string): Promise<void> {
    const candidates = await this.prisma.roomMember.findMany({
      where: { roomId, leftAt: null },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }], // ADMIN(asc enum) before MEMBER, then oldest
    });
    const next = candidates.find((c) => c.role === MemberRole.ADMIN) ?? candidates[0];
    if (next) {
      await this.prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId: next.userId } },
        data: { role: MemberRole.OWNER },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------
  private async requireGroup(roomId: string): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw Errors.notFound('채팅방을 찾을 수 없습니다.');
    if (room.type !== RoomType.GROUP) throw Errors.forbidden('그룹 채팅에서만 가능합니다.');
    return room;
  }

  private requireRole(role: MemberRole, allowed: MemberRole[]): void {
    if (!allowed.includes(role)) throw Errors.forbidden('해당 작업을 수행할 권한이 없습니다.');
  }

  private async emitLifecycle(
    event: string,
    roomId: string,
    memberUserIds: string[],
  ): Promise<void> {
    const room = await this.getRoomView(roomId, memberUserIds[0] ?? roomId);
    const payload: RoomLifecycleEvent = { room, roomId, memberUserIds };
    this.events.emit(event, payload);
  }

  private async collectAvatars(rooms: RoomWithMembers[]): Promise<Map<string, string>> {
    const ids: (string | null)[] = [];
    for (const room of rooms) {
      ids.push(room.avatarMediaId);
      for (const m of room.members) ids.push(m.user.profile?.avatarMediaId ?? null);
    }
    return this.media.resolveAvatarUrls(ids);
  }

  private buildView(
    room: RoomWithMembers,
    avatarMap: Map<string, string>,
    opts: { unreadCount?: number; includeLastMessage?: boolean },
  ): RoomView {
    const members: MemberView[] = room.members.map((m) => ({
      userId: m.userId,
      nickname: m.user.profile?.nickname ?? null,
      avatarUrl: m.user.profile?.avatarMediaId
        ? (avatarMap.get(m.user.profile.avatarMediaId) ?? null)
        : null,
      role: m.role,
    }));

    const last = room.messages[0];
    const view: RoomView = {
      id: room.id,
      type: room.type,
      name: room.name,
      avatarUrl: room.avatarMediaId ? (avatarMap.get(room.avatarMediaId) ?? null) : null,
      createdBy: room.createdBy,
      createdAt: room.createdAt.toISOString(),
      lastMessageAt: room.lastMessageAt ? room.lastMessageAt.toISOString() : null,
      members,
    };

    if (opts.includeLastMessage) {
      view.lastMessage = last
        ? {
            seq: Number(last.seq),
            type: last.type,
            preview: last.deletedAt ? '삭제된 메시지입니다.' : messagePreview(last.type, last.content),
            createdAt: last.createdAt.toISOString(),
          }
        : null;
    }
    if (opts.unreadCount !== undefined) view.unreadCount = opts.unreadCount;
    return view;
  }
}
