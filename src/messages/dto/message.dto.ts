import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Message types a client is allowed to send (SYSTEM is server-internal only).
export const SENDABLE_TYPES = [
  MessageType.TEXT,
  MessageType.IMAGE,
  MessageType.GIF,
  MessageType.VIDEO,
  MessageType.FILE,
] as const;

export class SendMessageDto {
  @ApiPropertyOptional({ description: '멱등성 키(클라이언트 UUID)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientMessageId?: string;

  @ApiProperty({ enum: SENDABLE_TYPES })
  @IsEnum(MessageType)
  type!: MessageType;

  @ApiPropertyOptional({ description: 'TEXT 본문 또는 미디어 캡션' })
  @ValidateIf((o) => o.type === MessageType.TEXT)
  @IsString()
  @MaxLength(8000)
  content?: string | null;

  @ApiPropertyOptional({ description: '미디어 메시지일 때 mediaId' })
  @IsOptional()
  @IsString()
  mediaId?: string | null;

  @ApiPropertyOptional({ description: '답장 대상 메시지 id' })
  @IsOptional()
  @IsString()
  replyToId?: string | null;
}

export class ReadDto {
  @ApiProperty({ example: 42 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastReadSeq!: number;
}
