import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { KakaoLoginDto, LogoutDto, RefreshDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('kakao')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '카카오 로그인/가입 (화이트리스트 검증)' })
  kakao(@Body() dto: KakaoLoginDto) {
    return this.authService.kakaoLogin(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '리프레시 토큰 회전' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: '로그아웃 (리프레시 토큰 무효화)' })
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보 + 온보딩 상태' })
  me(@CurrentUser('userId') userId: string) {
    return this.authService.me(userId);
  }
}
