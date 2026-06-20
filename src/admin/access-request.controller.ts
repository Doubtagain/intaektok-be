import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { PaginatedAccessRequestsResponse } from './dto/access-request-response.dto';
import { WhitelistResponse } from './dto/whitelist-response.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/access-requests')
export class AccessRequestController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @ApiOperation({ summary: '가입 대기 목록 (화이트리스트 미등록 로그인 시도)' })
  @ApiOkResponse({ type: PaginatedAccessRequestsResponse })
  list(@Query() dto: CursorPaginationDto) {
    return this.admin.listAccessRequests(dto);
  }

  @Post(':id/approve')
  @HttpCode(201)
  @ApiOperation({ summary: '가입 승인 (화이트리스트 INVITED로 승격 + 대기열 제거)' })
  @ApiCreatedResponse({ type: WhitelistResponse })
  approve(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.admin.approveAccessRequest(id, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '가입 대기 항목 삭제 (거절/무시)' })
  @ApiNoContentResponse({ description: '삭제 완료(본문 없음)' })
  async dismiss(@Param('id') id: string): Promise<void> {
    await this.admin.dismissAccessRequest(id);
  }
}
