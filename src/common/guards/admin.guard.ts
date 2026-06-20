import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { isAdminIdentity } from '../admin.util';
import { AuthUser } from '../types';
import { Errors } from '../errors';

/**
 * Minimal RBAC for the admin console: the caller's userId OR kakaoId must
 * appear in ADMIN_USER_IDS. Accepting kakaoIds avoids the bootstrap
 * chicken-and-egg (userId only exists after first login). Replace with a
 * proper roles table in production.
 * Must run AFTER JwtAuthGuard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    const adminIds = this.config.get<string[]>('admin.userIds') ?? [];
    if (!user?.userId || !adminIds.length) {
      throw Errors.forbidden('관리자 권한이 필요합니다.');
    }
    // Fast path: userId match needs no DB hit.
    if (isAdminIdentity(adminIds, user.userId)) return true;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { kakaoId: true },
    });
    if (isAdminIdentity(adminIds, user.userId, dbUser?.kakaoId)) return true;

    throw Errors.forbidden('관리자 권한이 필요합니다.');
  }
}
