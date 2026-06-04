import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateUploadUrlDto {
  @ApiProperty({ example: 'image/gif' })
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'mimeType 형식이 올바르지 않습니다.' })
  mimeType!: string;

  @ApiProperty({ example: 1048576, description: '바이트 크기' })
  @IsInt()
  @Min(1)
  @Max(1024 * 1024 * 1024)
  byteSize!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @ApiPropertyOptional({ description: '동영상/애니메이션 길이(ms)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMs?: number;
}
