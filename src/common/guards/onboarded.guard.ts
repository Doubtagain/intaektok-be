import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types';
import { Errors } from '../errors';

/**
 * Blocks access to feature APIs until the user has completed profile onboarding.
 * Must run AFTER JwtAuthGuard (relies on req.user).
 */
@Injectable()
export class OnboardedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    if (!user?.userId) throw Errors.unauthorized();

    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.userId },
      select: { onboardedAt: true },
    });
    if (!profile?.onboardedAt) {
      throw Errors.forbidden('프로필 온보딩이 필요합니다.', { reason: 'ONBOARDING_REQUIRED' });
    }
    return true;
  }
}
