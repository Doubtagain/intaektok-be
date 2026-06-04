import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProfileDto {
  @ApiProperty({ example: '택이' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname!: string;

  @ApiPropertyOptional({ example: '안녕하세요' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  statusMessage?: string;

  @ApiPropertyOptional({ description: '아바타 미디어 id' })
  @IsOptional()
  @IsString()
  avatarMediaId?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  statusMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarMediaId?: string;
}
