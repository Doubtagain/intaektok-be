import { ApiProperty } from '@nestjs/swagger';
import { MemberRole, MessageType, RoomType } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

export class RoomMemberResponse {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ enum: MemberRole })
  role!: MemberRole;
}

export class RoomLastMessageResponse {
  @ApiProperty({ description: '룸 내 단조 증가 시퀀스' })
  seq!: number;

  @ApiProperty({ enum: MessageType })
  type!: MessageType;

  @ApiProperty({ description: '미리보기 텍스트(삭제 시 placeholder)' })
  preview!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Shared room view returned by list/detail/create/update endpoints. */
export class RoomViewResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: RoomType })
  type!: RoomType;

  @ApiProperty({ type: String, nullable: true, description: 'GROUP 방 이름' })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastMessageAt!: string | null;

  @ApiProperty({ type: [RoomMemberResponse] })
  members!: RoomMemberResponse[];

  @ApiProperty({
    type: RoomLastMessageResponse,
    nullable: true,
    required: false,
    description: '마지막 메시지(없으면 null)',
  })
  lastMessage?: RoomLastMessageResponse | null;

  @ApiProperty({ required: false, description: '미읽음 메시지 수' })
  unreadCount?: number;
}

/** Response of `GET /rooms`. */
export class PaginatedRoomsResponse extends PaginatedResponse {
  @ApiProperty({ type: [RoomViewResponse] })
  items!: RoomViewResponse[];
}
