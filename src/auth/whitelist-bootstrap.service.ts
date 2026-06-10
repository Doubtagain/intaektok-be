import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhitelistStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Solves the closed-platform chicken-and-egg: nobody can log in until someone
 * is whitelisted, but the admin API requires a logged-in admin.
 *
 * Set WHITELIST_BOOTSTRAP_KAKAO_IDS=<kakaoId>,<kakaoId> and the listed ids are
 * registered as INVITED at boot. Idempotent: existing entries are left alone —
 * in particular a BLOCKED entry is never re-activated by this path.
 */
@Injectable()
export class WhitelistBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WhitelistBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const kakaoIds = this.config.get<string[]>('whitelist.bootstrapKakaoIds') ?? [];
    if (!kakaoIds.length) return;

    let created = 0;
    for (const kakaoId of kakaoIds) {
      const existing = await this.prisma.whitelist.findUnique({ where: { kakaoId } });
      if (existing) continue;
      await this.prisma.whitelist.create({
        data: { kakaoId, status: WhitelistStatus.INVITED, note: 'env bootstrap' },
      });
      created++;
    }
    this.logger.log(
      `Whitelist bootstrap: ${created} created, ${kakaoIds.length - created} already present`,
    );
  }
}
