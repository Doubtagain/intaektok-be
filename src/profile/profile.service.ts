import { Injectable } from '@nestjs/common';
import { Profile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { Errors } from '../common/errors';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /** F3: first-time onboarding. Idempotency guard: 409 if already onboarded. */
  async create(userId: string, dto: CreateProfileDto): Promise<Profile & { avatarUrl: string | null }> {
    const existing = await this.prisma.profile.findUnique({ where: { userId } });
    if (existing?.onboardedAt) {
      throw Errors.conflict('이미 온보딩이 완료된 사용자입니다.');
    }
    await this.media.assertOwnedMediaOrNull(dto.avatarMediaId, userId);

    const profile = await this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        nickname: dto.nickname,
        statusMessage: dto.statusMessage ?? null,
        avatarMediaId: dto.avatarMediaId ?? null,
        onboardedAt: new Date(),
      },
      update: {
        nickname: dto.nickname,
        statusMessage: dto.statusMessage ?? null,
        avatarMediaId: dto.avatarMediaId ?? null,
        onboardedAt: new Date(),
      },
    });
    return { ...profile, avatarUrl: await this.media.resolveAvatarUrl(profile.avatarMediaId) };
  }

  async update(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<Profile & { avatarUrl: string | null }> {
    const existing = await this.prisma.profile.findUnique({ where: { userId } });
    if (!existing) throw Errors.notFound('프로필을 찾을 수 없습니다.');
    await this.media.assertOwnedMediaOrNull(dto.avatarMediaId, userId);

    const profile = await this.prisma.profile.update({
      where: { userId },
      data: {
        ...(dto.nickname !== undefined ? { nickname: dto.nickname } : {}),
        ...(dto.statusMessage !== undefined ? { statusMessage: dto.statusMessage } : {}),
        ...(dto.avatarMediaId !== undefined ? { avatarMediaId: dto.avatarMediaId } : {}),
      },
    });
    return { ...profile, avatarUrl: await this.media.resolveAvatarUrl(profile.avatarMediaId) };
  }
}
