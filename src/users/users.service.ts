import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { Errors } from '../common/errors';
import { Paginated } from '../common/dto/pagination.dto';
import { SearchUsersDto } from './dto/search.dto';

export interface PublicUser {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /** Whether two users share at least one active room (for profile visibility). */
  private async shareRoom(a: string, b: string): Promise<boolean> {
    if (a === b) return true;
    const m = await this.prisma.roomMember.findFirst({
      where: {
        userId: a,
        leftAt: null,
        room: { members: { some: { userId: b, leftAt: null } } },
      },
      select: { roomId: true },
    });
    return !!m;
  }

  /** Profile of another user — only if same user or shares a room (spec §6.3). */
  async getProfile(targetUserId: string, requesterId: string) {
    if (!(await this.shareRoom(requesterId, targetUserId))) {
      throw Errors.forbidden('해당 사용자의 프로필을 조회할 권한이 없습니다.');
    }
    const profile = await this.prisma.profile.findUnique({
      where: { userId: targetUserId },
      include: { user: { select: { lastSeenAt: true } } },
    });
    if (!profile) throw Errors.notFound('프로필을 찾을 수 없습니다.');

    return {
      id: targetUserId,
      nickname: profile.nickname,
      statusMessage: profile.statusMessage,
      avatarUrl: await this.media.resolveAvatarUrl(profile.avatarMediaId),
      lastSeenAt: profile.user.lastSeenAt,
    };
  }

  /** F12: search registered (ACTIVE) users by nickname, within the closed platform. */
  async search(requesterId: string, dto: SearchUsersDto): Promise<Paginated<PublicUser>> {
    const limit = dto.limit ?? 50;
    const profiles = await this.prisma.profile.findMany({
      where: {
        nickname: { contains: dto.q, mode: 'insensitive' },
        onboardedAt: { not: null },
        userId: { not: requesterId },
        user: { status: 'ACTIVE' },
        ...(dto.cursor ? { userId: { gt: dto.cursor, not: requesterId } } : {}),
      },
      orderBy: { userId: 'asc' },
      take: limit + 1,
    });

    const hasMore = profiles.length > limit;
    const page = hasMore ? profiles.slice(0, limit) : profiles;
    const avatarMap = await this.media.resolveAvatarUrls(page.map((p) => p.avatarMediaId));

    return {
      items: page.map((p) => ({
        id: p.userId,
        nickname: p.nickname,
        avatarUrl: p.avatarMediaId ? (avatarMap.get(p.avatarMediaId) ?? null) : null,
      })),
      nextCursor: hasMore ? page[page.length - 1].userId : null,
    };
  }
}
