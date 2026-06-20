import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Swagger base for cursor-paginated responses. Each list endpoint declares a
 * concrete subclass that overrides `items` with its element type, e.g.
 * `class PaginatedRoomsResponse extends PaginatedResponse { items: RoomViewResponse[] }`.
 * Runtime payloads come from the `Paginated<T>` interface above — this class
 * exists purely to document the response shape in the OpenAPI spec.
 */
export abstract class PaginatedResponse {
  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: '다음 페이지 커서. null이면 마지막 페이지입니다.',
  })
  nextCursor!: string | null;
}
