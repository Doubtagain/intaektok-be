import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Cursor-based pagination query (spec §6.1). */
export class CursorPaginationDto {
  @ApiPropertyOptional({ description: '커서(seq 또는 id 또는 ISO 타임스탬프)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: '페이지 크기', default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
