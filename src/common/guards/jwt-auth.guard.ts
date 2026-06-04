import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Errors } from '../errors';

/** HTTP guard backed by the passport-jwt 'jwt' strategy (access tokens). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: any, _info: any, _context: ExecutionContext): TUser {
    if (err || !user) {
      throw Errors.unauthorized('유효하지 않거나 만료된 토큰입니다.');
    }
    return user as TUser;
  }
}
