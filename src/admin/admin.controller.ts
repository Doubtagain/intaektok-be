import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { CreateWhitelistDto, ListWhitelistDto, UpdateWhitelistDto } from './dto/whitelist.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/whitelist')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: '화이트리스트 등록/초대' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateWhitelistDto) {
    return this.admin.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: '화이트리스트 목록' })
  list(@Query() dto: ListWhitelistDto) {
    return this.admin.list(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '화이트리스트 상태 변경 (BLOCKED 시 세션 무효화)' })
  update(@Param('id') id: string, @Body() dto: UpdateWhitelistDto) {
    return this.admin.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '화이트리스트 삭제' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.admin.remove(id);
  }
}
