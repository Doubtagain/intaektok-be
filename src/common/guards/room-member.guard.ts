import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types';
import { Errors } from '../errors';

export interface ActiveMembership {
  roomId: string;
  userId: string;
  role: MemberRole;
}

declare module 'express' {
  interface Request {
    roomMember?: ActiveMembership;
  }
}

/**
 * IDOR guard: ensures the caller is an ACTIVE member (leftAt = null) of the
 * room identified by `:roomId`. Attaches req.roomMember for role checks.
 * Must run AFTER JwtAuthGuard.
 */
@Injectable()
export class RoomMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    const roomId: string | undefined = req.params?.roomId;
    if (!user?.userId) throw Errors.unauthorized();
    if (!roomId) throw Errors.validation('roomId가 필요합니다.');

    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.userId } },
      select: { role: true, leftAt: true },
    });

    if (!membership || membership.leftAt) {
      throw Errors.forbidden('해당 채팅방에 접근할 권한이 없습니다.');
    }

    req.roomMember = { roomId, userId: user.userId, role: membership.role };
    return true;
  }
}
