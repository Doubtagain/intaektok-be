import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole, RoomType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ enum: RoomType })
  @IsEnum(RoomType)
  type!: RoomType;

  @ApiPropertyOptional({ description: 'GROUP 방 이름' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarMediaId?: string;

  @ApiProperty({ description: '상대(DIRECT=1명) 또는 초대 멤버(GROUP)', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  memberUserIds!: string[];
}

export class UpdateRoomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarMediaId?: string;
}

export class AddMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  userIds!: string[];
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: [MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.OWNER] })
  @IsEnum(MemberRole)
  role!: MemberRole;
}
