import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessRequest, Prisma, Whitelist, WhitelistStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Errors } from '../common/errors';
import { CursorPaginationDto, Paginated } from '../common/dto/pagination.dto';
import { DomainEvents, SessionRevokedEvent } from '../common/events';
import { CreateWhitelistDto, ListWhitelistDto, UpdateWhitelistDto } from './dto/whitelist.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: EventEmitter2,
  ) {}

  async create(dto: CreateWhitelistDto, invitedBy: string): Promise<Whitelist> {
    if (!dto.kakaoId && !dto.identifier) {
      throw Errors.validation('kakaoId 또는 identifier 중 하나는 필요합니다.');
    }
    if (dto.kakaoId) {
      const exists = await this.prisma.whitelist.findUnique({ where: { kakaoId: dto.kakaoId } });
      if (exists) throw Errors.conflict('이미 등록된 kakaoId 입니다.');
    }
    return this.prisma.whitelist.create({
      data: {
        kakaoId: dto.kakaoId ?? null,
        identifier: dto.identifier ?? null,
        note: dto.note ?? null,
        invitedBy,
        status: WhitelistStatus.INVITED,
      },
    });
  }

  async list(dto: ListWhitelistDto): Promise<Paginated<Whitelist>> {
    const limit = dto.limit ?? 50;
    const where: Prisma.WhitelistWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.cursor) where.createdAt = { lt: new Date(dto.cursor) };

    const rows = await this.prisma.whitelist.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  async update(id: string, dto: UpdateWhitelistDto): Promise<Whitelist> {
    const existing = await this.prisma.whitelist.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('화이트리스트 항목을 찾을 수 없습니다.');

    const updated = await this.prisma.whitelist.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    if (dto.status === WhitelistStatus.BLOCKED) {
      await this.enforceBlock(updated);
    } else if (dto.status && existing.status === WhitelistStatus.BLOCKED) {
      // Un-blocking (status set to INVITED/ACTIVE from BLOCKED).
      await this.reactivate(updated);
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.whitelist.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('화이트리스트 항목을 찾을 수 없습니다.');
    await this.prisma.whitelist.delete({ where: { id } });
  }

  /** BLOCKED: suspend the linked user, revoke refresh tokens, disconnect sockets. */
  private async enforceBlock(whitelist: Whitelist): Promise<void> {
    if (!whitelist.kakaoId) return;
    const user = await this.prisma.user.findUnique({ where: { kakaoId: whitelist.kakaoId } });
    if (!user) return;

    await this.prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await this.redis.delByPattern(`refresh:${user.id}:*`);
    const payload: SessionRevokedEvent = { userId: user.id };
    this.events.emit(DomainEvents.SESSION_REVOKED, payload);
    this.logger.warn(`Blocked & revoked sessions for user ${user.id}`);
  }

  private async reactivate(whitelist: Whitelist): Promise<void> {
    if (!whitelist.kakaoId) return;
    const user = await this.prisma.user.findUnique({ where: { kakaoId: whitelist.kakaoId } });
    if (user && user.status === 'SUSPENDED') {
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    }
  }

  // ---------------------------------------------------------------------------
  // Access requests — the "login first, approve later" queue. Unregistered
  // login attempts land here (auth.service) so an admin can promote them to the
  // whitelist without ever needing to know a kakaoId up front.
  // ---------------------------------------------------------------------------
  async listAccessRequests(dto: CursorPaginationDto): Promise<Paginated<AccessRequest>> {
    const limit = dto.limit ?? 50;
    const where: Prisma.AccessRequestWhereInput = {};
    if (dto.cursor) where.createdAt = { lt: new Date(dto.cursor) };

    const rows = await this.prisma.accessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  /**
   * Approve a pending request: promote its kakaoId to the whitelist (INVITED)
   * and clear the queue entry. Idempotent against an already-whitelisted kakaoId
   * (race with manual registration); refuses to silently approve a BLOCKED one.
   */
  async approveAccessRequest(id: string, invitedBy: string): Promise<Whitelist> {
    const request = await this.prisma.accessRequest.findUnique({ where: { id } });
    if (!request) throw Errors.notFound('가입 대기 항목을 찾을 수 없습니다.');

    const existing = await this.prisma.whitelist.findUnique({
      where: { kakaoId: request.kakaoId },
    });
    if (existing) {
      if (existing.status === WhitelistStatus.BLOCKED) {
        throw Errors.conflict('차단된 사용자입니다. 먼저 차단을 해제하세요.');
      }
      // Already whitelisted — just drain the queue and return the existing row.
      await this.prisma.accessRequest.delete({ where: { id } });
      return existing;
    }

    const whitelist = await this.prisma.whitelist.create({
      data: {
        kakaoId: request.kakaoId,
        status: WhitelistStatus.INVITED,
        invitedBy,
        note: request.nickname ? `가입 요청 승인: ${request.nickname}` : '가입 요청 승인',
      },
    });
    await this.prisma.accessRequest.delete({ where: { id } });
    return whitelist;
  }

  /** Dismiss (reject/ignore) a pending request without whitelisting it. */
  async dismissAccessRequest(id: string): Promise<void> {
    const res = await this.prisma.accessRequest.deleteMany({ where: { id } });
    if (res.count === 0) throw Errors.notFound('가입 대기 항목을 찾을 수 없습니다.');
  }
}
