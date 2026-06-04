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
import { RoomMembership } from '../common/decorators/room-member.decorator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { ActiveMembership } from '../common/guards/room-member.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OnboardedGuard } from '../common/guards/onboarded.guard';
import { RoomMemberGuard } from '../common/guards/room-member.guard';
import { RoomsService } from './rooms.service';
import { AddMembersDto, CreateRoomDto, UpdateMemberRoleDto, UpdateRoomDto } from './dto/room.dto';

@ApiTags('rooms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OnboardedGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  @ApiOperation({ summary: '내 채팅방 목록 (최근 활동순, 미읽음 수 포함)' })
  list(@CurrentUser('userId') userId: string, @Query() q: CursorPaginationDto) {
    return this.rooms.listRooms(userId, q.cursor, q.limit ?? 30);
  }

  @Post()
  @ApiOperation({ summary: '방 생성 (1:1 중복 시 기존 방 반환 / 그룹)' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateRoomDto) {
    return this.rooms.createRoom(userId, dto);
  }

  @Get(':roomId')
  @UseGuards(RoomMemberGuard)
  @ApiOperation({ summary: '방 상세 + 멤버 목록' })
  detail(@CurrentUser('userId') userId: string, @Param('roomId') roomId: string) {
    return this.rooms.getRoomView(roomId, userId);
  }

  @Patch(':roomId')
  @UseGuards(RoomMemberGuard)
  @ApiOperation({ summary: '방 정보 수정 (그룹, OWNER/ADMIN)' })
  update(
    @Param('roomId') roomId: string,
    @RoomMembership() membership: ActiveMembership,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.rooms.updateRoom(roomId, membership.userId, membership.role, dto);
  }

  @Post(':roomId/members')
  @UseGuards(RoomMemberGuard)
  @ApiOperation({ summary: '멤버 추가 (그룹, OWNER/ADMIN)' })
  addMembers(
    @Param('roomId') roomId: string,
    @RoomMembership() membership: ActiveMembership,
    @Body() dto: AddMembersDto,
  ) {
    return this.rooms.addMembers(roomId, membership.userId, membership.role, dto);
  }

  @Patch(':roomId/members/:userId')
  @UseGuards(RoomMemberGuard)
  @ApiOperation({ summary: '멤버 역할 변경 (그룹, OWNER)' })
  updateMemberRole(
    @Param('roomId') roomId: string,
    @Param('userId') userId: string,
    @RoomMembership() membership: ActiveMembership,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.rooms.updateMemberRole(roomId, membership.userId, membership.role, userId, dto);
  }

  @Delete(':roomId/members/:userId')
  @UseGuards(RoomMemberGuard)
  @HttpCode(204)
  @ApiOperation({ summary: '멤버 탈퇴(본인) 또는 추방(OWNER/ADMIN)' })
  async removeMember(
    @Param('roomId') roomId: string,
    @Param('userId') userId: string,
    @RoomMembership() membership: ActiveMembership,
  ): Promise<void> {
    await this.rooms.removeMember(roomId, membership.userId, membership.role, userId);
  }
}
