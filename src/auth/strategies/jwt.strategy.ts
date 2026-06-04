import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenPayload, AuthUser } from '../../common/types';
import { Errors } from '../../common/errors';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret')!,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (payload.type !== 'access') throw Errors.unauthorized();

    // Enforce account status on every request so BLOCKED/SUSPENDED users are
    // rejected immediately (defense for the whitelist-block flow).
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw Errors.unauthorized('비활성화된 계정입니다.');
    }
    return { userId: payload.sub };
  }
}
