import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WhitelistStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaService } from '../media/media.service';
import { Errors } from '../common/errors';
import { isAdminIdentity } from '../common/admin.util';
import { AccessTokenPayload, RefreshTokenPayload } from '../common/types';
import { KakaoService, KakaoUserInfo } from './kakao.service';
import { KakaoLoginDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends TokenPair {
  user: { id: string; kakaoId: string };
  isOnboarded: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly kakao: KakaoService,
    private readonly media: MediaService,
  ) {}

  private refreshKey(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  /** F1 + F2: Kakao login/sign-up with whitelist enforcement. */
  async kakaoLogin(dto: KakaoLoginDto): Promise<LoginResult> {
    // OAuth authorization-code flow: exchange the single-use code for a Kakao
    // access token server-side (secret stays on the server), then resolve the
    // identity. The browser never handles a Kakao access token or the secret.
    const accessToken = await this.kakao.exchangeCodeForToken(dto.code, dto.redirectUri);
    const info = await this.kakao.getUserInfo(accessToken);

    const whitelist = await this.prisma.whitelist.findUnique({
      where: { kakaoId: info.kakaoId },
    });
    if (!whitelist || whitelist.status === WhitelistStatus.BLOCKED) {
      // Only NOT_REGISTERED attempts join the approval queue — a BLOCKED user is
      // already a known whitelist decision and must not resurface as "pending".
      if (!whitelist) await this.recordAccessRequest(info);
      // Operational aid: a closed platform's admin needs the kakaoId to
      // whitelist someone — surface it for rejected attempts.
      this.logger.warn(
        `Login rejected by whitelist (kakaoId=${info.kakaoId}, reason=${whitelist ? 'BLOCKED' : 'NOT_REGISTERED'})`,
      );
      throw Errors.notAllowed();
    }

    // Upsert user + flip INVITED -> ACTIVE atomically.
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.upsert({
        where: { kakaoId: info.kakaoId },
        update: { status: 'ACTIVE' },
        create: { kakaoId: info.kakaoId, status: 'ACTIVE' },
      });
      if (whitelist.status === WhitelistStatus.INVITED) {
        await tx.whitelist.update({
          where: { id: whitelist.id },
          data: { status: WhitelistStatus.ACTIVE },
        });
      }
      return u;
    });

    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      select: { onboardedAt: true },
    });

    const tokens = await this.issueTokens(user.id);
    return {
      ...tokens,
      user: { id: user.id, kakaoId: user.kakaoId },
      isOnboarded: !!profile?.onboardedAt,
    };
  }

  /**
   * Queue an unregistered login attempt so an admin can approve it from the
   * console (closed-platform onboarding aid). Best-effort: a bookkeeping failure
   * must never turn the 403 rejection into a 500.
   */
  private async recordAccessRequest(info: KakaoUserInfo): Promise<void> {
    try {
      await this.prisma.accessRequest.upsert({
        where: { kakaoId: info.kakaoId },
        create: {
          kakaoId: info.kakaoId,
          nickname: info.nickname ?? null,
          profileImageUrl: info.profileImageUrl ?? null,
        },
        update: {
          attempts: { increment: 1 },
          nickname: info.nickname ?? null,
          profileImageUrl: info.profileImageUrl ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record access request (kakaoId=${info.kakaoId}): ${(err as Error).message}`,
      );
    }
  }

  async issueTokens(userId: string): Promise<TokenPair> {
    const accessSecret = this.config.get<string>('jwt.accessSecret')!;
    const refreshSecret = this.config.get<string>('jwt.refreshSecret')!;
    const accessTtl = this.config.get<number>('jwt.accessTtl')!;
    const refreshTtl = this.config.get<number>('jwt.refreshTtl')!;
    const jti = uuidv4();

    const accessPayload: AccessTokenPayload = { sub: userId, type: 'access' };
    const refreshPayload: RefreshTokenPayload = { sub: userId, type: 'refresh', jti };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, { secret: accessSecret, expiresIn: accessTtl }),
      this.jwt.signAsync(refreshPayload, { secret: refreshSecret, expiresIn: refreshTtl }),
    ]);

    // Whitelist the refresh token's jti in Redis (rotation support).
    await this.redis.set(this.refreshKey(userId, jti), '1', refreshTtl);
    return { accessToken, refreshToken };
  }

  /** Rotating refresh: validates jti, revokes it, issues a fresh pair. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const refreshSecret = this.config.get<string>('jwt.refreshSecret')!;
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw Errors.unauthorized('유효하지 않은 리프레시 토큰입니다.');
    }
    if (payload.type !== 'refresh') throw Errors.unauthorized();

    const key = this.refreshKey(payload.sub, payload.jti);
    const exists = await this.redis.exists(key);
    if (!exists) {
      // Reuse / revoked token — defensively revoke all sessions.
      await this.revokeAllSessions(payload.sub);
      throw Errors.unauthorized('만료되었거나 이미 사용된 리프레시 토큰입니다.');
    }

    // Ensure the user is still active (e.g. not BLOCKED).
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      await this.revokeAllSessions(payload.sub);
      throw Errors.unauthorized();
    }

    await this.redis.del(key); // rotate out the old jti
    return this.issueTokens(payload.sub);
  }

  async logout(refreshToken: string): Promise<void> {
    const refreshSecret = this.config.get<string>('jwt.refreshSecret')!;
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: refreshSecret,
      });
      if (payload.type !== 'refresh') return; // defense-in-depth (matches refresh())
      await this.redis.del(this.refreshKey(payload.sub, payload.jti));
    } catch {
      // Logout is idempotent — swallow invalid tokens.
    }
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.redis.delByPattern(`refresh:${userId}:*`);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw Errors.notFound('사용자를 찾을 수 없습니다.');

    const avatarUrl = await this.media.resolveAvatarUrl(user.profile?.avatarMediaId);
    const adminIds = this.config.get<string[]>('admin.userIds') ?? [];
    return {
      id: user.id,
      kakaoId: user.kakaoId,
      isOnboarded: !!user.profile?.onboardedAt,
      isAdmin: isAdminIdentity(adminIds, user.id, user.kakaoId),
      profile: user.profile
        ? {
            nickname: user.profile.nickname,
            statusMessage: user.profile.statusMessage,
            avatarMediaId: user.profile.avatarMediaId,
            avatarUrl,
          }
        : null,
    };
  }
}
