import { Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  register(@CurrentUser('userId') userId: string, @Body() dto: RegisterTokenDto) {
    return this.push.registerToken(userId, dto);
  }

  @Delete('tokens/:tokenId')
  @HttpCode(204)
  @ApiOperation({ summary: 'FCM 토큰 삭제' })
  async remove(
    @CurrentUser('userId') userId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<void> {
    await this.push.removeToken(userId, tokenId);
  }
}
