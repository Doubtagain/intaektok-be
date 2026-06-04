import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../types';

/** Injects the authenticated principal ({ userId }) populated by JwtStrategy. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | string => {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    return data ? user?.[data] : user;
  },
);
