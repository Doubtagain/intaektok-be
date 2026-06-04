import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OnboardedGuard } from '../common/guards/onboarded.guard';
import { UsersService } from './users.service';
import { SearchUsersDto } from './dto/search.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OnboardedGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('search')
  @ApiOperation({ summary: '등록 사용자 검색 (닉네임)' })
  search(@CurrentUser('userId') userId: string, @Query() dto: SearchUsersDto) {
    return this.usersService.search(userId, dto);
  }

  @Get(':userId/profile')
  @ApiOperation({ summary: '사용자 프로필 조회 (같은 룸/연락처만)' })
  getProfile(@CurrentUser('userId') requesterId: string, @Param('userId') userId: string) {
    return this.usersService.getProfile(userId, requesterId);
  }
}
