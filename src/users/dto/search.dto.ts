import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class SearchUsersDto extends CursorPaginationDto {
  @ApiProperty({ description: '검색 키워드(닉네임)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  q!: string;
}
