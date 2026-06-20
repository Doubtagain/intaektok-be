import { Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PushTokenResponse } from './dto/push-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PushService } from './push.service';
import { RegisterTokenDto } from './dto/push.dto';

@ApiTags('push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('tokens')
  @HttpCode(201)
  @ApiOperation({ summary: 'FCM 토큰 등록' })
  @ApiCreatedResponse({ type: PushTokenResponse })
  register(@CurrentUser('userId') userId: string, @Body() dto: RegisterTokenDto) {
    return this.push.registerToken(userId, dto);
  }

  @Delete('tokens/:tokenId')
  @HttpCode(204)
  @ApiOperation({ summary: 'FCM 토큰 삭제' })
  @ApiNoContentResponse({ description: '삭제 완료(본문 없음)' })
  async remove(
    @CurrentUser('userId') userId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<void> {
    await this.push.removeToken(userId, tokenId);
  }
}
