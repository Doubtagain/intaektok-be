import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OnboardedGuard } from '../common/guards/onboarded.guard';
import { RoomMemberGuard } from '../common/guards/room-member.guard';
import { MessagesService } from './messages.service';
import { ReadDto, SendMessageDto } from './dto/message.dto';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OnboardedGuard, RoomMemberGuard)
@Controller('rooms/:roomId')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('messages')
  @ApiOperation({ summary: '메시지 이력 (커서 페이지네이션, seq < cursor 인 과거 메시지)' })
  list(@Param('roomId') roomId: string, @Query() q: CursorPaginationDto) {
    return this.messages.listMessages(roomId, q.cursor, q.limit ?? 50);
  }

  @Post('messages')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '메시지 전송 (REST 폴백). 기본 전송은 WebSocket 사용' })
  async send(
    @Param('roomId') roomId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: SendMessageDto,
  ) {
    const { message } = await this.messages.createMessage({
      roomId,
      senderId: userId,
      type: dto.type,
      content: dto.content,
      mediaId: dto.mediaId,
      replyToId: dto.replyToId,
      clientMessageId: dto.clientMessageId,
    });
    return { id: message.id, seq: message.seq, createdAt: message.createdAt };
  }

  @Delete('messages/:messageId')
  @HttpCode(204)
  @ApiOperation({ summary: '메시지 삭제(언센드) — 발신자 본인' })
  async remove(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @CurrentUser('userId') userId: string,
  ): Promise<void> {
    await this.messages.softDelete(roomId, messageId, userId);
  }

  @Post('read')
  @HttpCode(204)
  @ApiOperation({ summary: '읽음 위치 갱신' })
  async read(
    @Param('roomId') roomId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: ReadDto,
  ): Promise<void> {
    await this.messages.markRead(roomId, userId, dto.lastReadSeq);
  }
}
