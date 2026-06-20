import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

/**
 * Serialized message — identical shape on REST responses and the WS
 * `message:new` event. Deleted messages null out `content`/`mediaId`.
 */
export class MessageResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  roomId!: string;

  @ApiProperty()
  senderId!: string;

  @ApiProperty({ description: '룸 내 단조 증가 시퀀스' })
  seq!: number;

  @ApiProperty({ enum: MessageType })
  type!: MessageType;

  @ApiProperty({ type: String, nullable: true, description: 'TEXT 본문(삭제/미디어면 null)' })
  content!: string | null;

  @ApiProperty({ type: String, nullable: true })
  mediaId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  replyToId!: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, description: '멱등성 키' })
  clientMessageId?: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  editedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt!: string | null;

  @ApiProperty({ required: false, description: '발신자 제외, 읽은 멤버 수' })
  readCount?: number;
}

/** Response of `GET /rooms/:roomId/messages`. */
export class PaginatedMessagesResponse extends PaginatedResponse {
  @ApiProperty({ type: [MessageResponse] })
  items!: MessageResponse[];
}

/** Response of `POST /rooms/:roomId/messages` (REST fallback send). */
export class SendMessageResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '발급된 시퀀스' })
  seq!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
