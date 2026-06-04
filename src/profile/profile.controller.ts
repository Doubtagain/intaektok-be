import { Body, Controller, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '최초 온보딩 (닉네임/아바타/상태메시지)' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateProfileDto) {
    return this.profileService.create(userId, dto);
  }

  @Patch()
  @ApiOperation({ summary: '프로필 부분 수정' })
  update(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.profileService.update(userId, dto);
  }
}
