import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from '../types';
import { Errors } from '../errors';

/**
 * Minimal RBAC for the admin console: the caller's userId must appear in
 * ADMIN_USER_IDS. Replace with a proper roles table in production.
 * Must run AFTER JwtAuthGuard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    const adminIds = this.config.get<string[]>('admin.userIds') ?? [];
    if (!user?.userId || !adminIds.includes(user.userId)) {
      throw Errors.forbidden('관리자 권한이 필요합니다.');
    }
    return true;
  }
}
