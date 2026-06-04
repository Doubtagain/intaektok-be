import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WhitelistStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateWhitelistDto {
  @ApiPropertyOptional({ description: '카카오 회원번호' })
  @IsOptional()
  @IsString()
  kakaoId?: string;

  @ApiPropertyOptional({ description: '대체 식별자(이메일/전화 등)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  identifier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateWhitelistDto {
  @ApiPropertyOptional({ enum: WhitelistStatus })
  @IsOptional()
  @IsEnum(WhitelistStatus)
  status?: WhitelistStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListWhitelistDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: WhitelistStatus })
  @IsOptional()
  @IsEnum(WhitelistStatus)
  status?: WhitelistStatus;
}
