import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Media } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { Errors } from '../common/errors';
import { StorageService } from './storage.service';
import { CreateUploadUrlDto } from './dto/media.dto';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/apng': 'apng',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

// MIME types whose media is auto-play candidates (움짤).
const ANIMATED_MIME = new Set(['image/gif', 'image/webp', 'image/apng']);

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.maxBytes = this.config.get<number>('policy.mediaMaxBytes')!;
  }

  private extFor(mime: string): string {
    return EXT_BY_MIME[mime] ?? 'bin';
  }

  private isAnimatedMime(mime: string): boolean {
    // GIF/animated-WebP/APNG always; muted short videos are treated as
    // auto-play candidates too (client decides actual playback policy).
    return ANIMATED_MIME.has(mime) || mime.startsWith('video/');
  }

  /** F10: issue a presigned upload URL and create the PENDING media record. */
  async createUploadUrl(uploaderId: string, dto: CreateUploadUrlDto) {
    if (dto.byteSize > this.maxBytes) {
      throw Errors.validation('파일 크기가 허용 한도를 초과했습니다.', {
        maxBytes: this.maxBytes,
      });
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const storageKey = `media/${yyyy}/${mm}/${uuidv4()}.${this.extFor(dto.mimeType)}`;

    const media = await this.prisma.media.create({
      data: {
        uploaderId,
        storageKey,
        mimeType: dto.mimeType,
        byteSize: dto.byteSize,
        width: dto.width ?? null,
        height: dto.height ?? null,
        durationMs: dto.durationMs ?? null,
        isAnimated: this.isAnimatedMime(dto.mimeType),
        status: 'PENDING',
      },
    });

    const uploadUrl = await this.storage.getUploadUrl(storageKey, dto.mimeType);
    return { mediaId: media.id, uploadUrl, storageKey };
  }

  /**
   * Confirm an upload finished. Verifies the object exists and marks it READY.
   * Thumbnail/metadata extraction (sharp/ffmpeg) is an optional extension point.
   */
  async complete(mediaId: string, requesterId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw Errors.notFound('미디어를 찾을 수 없습니다.');
    if (media.uploaderId !== requesterId) throw Errors.forbidden();

    const head = await this.storage.headObject(media.storageKey);
    if (!head) throw Errors.validation('업로드된 객체를 찾을 수 없습니다.');

    const updated = await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        status: 'READY',
        byteSize: head.contentLength ?? media.byteSize,
      },
    });
    return this.serialize(updated, await this.storage.getDownloadUrl(updated.storageKey));
  }

  /** F10: authorized metadata + download URL for a single media object. */
  async getMedia(mediaId: string, requesterId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw Errors.notFound('미디어를 찾을 수 없습니다.');

    const allowed = await this.canAccess(media, requesterId);
    if (!allowed) throw Errors.forbidden('미디어에 접근할 권한이 없습니다.');

    const url = await this.storage.getDownloadUrl(media.storageKey);
    return this.serialize(media, url);
  }

  /**
   * Access policy (closed platform):
   *  - uploader, or
   *  - media is attached to a message in a room the requester belongs to, or
   *  - media is used as a profile avatar (visible to all members), or
   *  - media is a room avatar of a room the requester belongs to.
   */
  private async canAccess(media: Media, requesterId: string): Promise<boolean> {
    if (media.uploaderId === requesterId) return true;

    const sharedMessage = await this.prisma.message.findFirst({
      where: {
        mediaId: media.id,
        room: { members: { some: { userId: requesterId, leftAt: null } } },
      },
      select: { id: true },
    });
    if (sharedMessage) return true;

    const asAvatar = await this.prisma.profile.findFirst({
      where: { avatarMediaId: media.id },
      select: { userId: true },
    });
    if (asAvatar) return true;

    const asRoomAvatar = await this.prisma.room.findFirst({
      where: {
        avatarMediaId: media.id,
        members: { some: { userId: requesterId, leftAt: null } },
      },
      select: { id: true },
    });
    return !!asRoomAvatar;
  }

  private serialize(media: Media, url: string) {
    return {
      mediaId: media.id,
      url,
      thumbnailUrl: media.thumbnailKey ? this.storage.buildPublicUrl(media.thumbnailKey) : null,
      mimeType: media.mimeType,
      isAnimated: media.isAnimated,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
    };
  }

  /**
   * Assert the caller owns a media object before it can be *referenced*
   * (message attachment, profile/room avatar). Prevents cross-user media
   * association (IDOR) at the point of reference creation.
   */
  async assertOwnedMedia(mediaId: string, userId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { uploaderId: true },
    });
    if (!media) throw Errors.notFound('미디어를 찾을 수 없습니다.');
    if (media.uploaderId !== userId) {
      throw Errors.forbidden('본인이 업로드한 미디어만 사용할 수 있습니다.');
    }
  }

  /** Same as assertOwnedMedia but a no-op when mediaId is null/undefined. */
  async assertOwnedMediaOrNull(mediaId: string | null | undefined, userId: string): Promise<void> {
    if (mediaId) await this.assertOwnedMedia(mediaId, userId);
  }

  /** Resolve a (possibly null) avatar mediaId to a public URL — for profile views. */
  async resolveAvatarUrl(mediaId: string | null | undefined): Promise<string | null> {
    if (!mediaId) return null;
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { storageKey: true },
    });
    return media ? this.storage.buildPublicUrl(media.storageKey) : null;
  }

  /** Batch avatar resolution to avoid N+1 in list endpoints. */
  async resolveAvatarUrls(mediaIds: (string | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [...new Set(mediaIds.filter((id): id is string => !!id))];
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const rows = await this.prisma.media.findMany({
      where: { id: { in: ids } },
      select: { id: true, storageKey: true },
    });
    for (const r of rows) out.set(r.id, this.storage.buildPublicUrl(r.storageKey));
    return out;
  }
}
