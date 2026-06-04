import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OnboardedGuard } from '../common/guards/onboarded.guard';
import { MediaService } from './media.service';
import { CreateUploadUrlDto } from './dto/media.dto';

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OnboardedGuard)
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-url')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: '업로드용 presigned URL 발급' })
  createUploadUrl(@CurrentUser('userId') userId: string, @Body() dto: CreateUploadUrlDto) {
    return this.mediaService.createUploadUrl(userId, dto);
  }

  @Post(':mediaId/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '업로드 완료 확정 (객체 존재 확인 + READY)' })
  complete(@CurrentUser('userId') userId: string, @Param('mediaId') mediaId: string) {
    return this.mediaService.complete(mediaId, userId);
  }

  @Get(':mediaId')
  @ApiOperation({ summary: '미디어 메타데이터 + 다운로드 URL (권한 검증)' })
  getMedia(@CurrentUser('userId') userId: string, @Param('mediaId') mediaId: string) {
    return this.mediaService.getMedia(mediaId, userId);
  }
}
