import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

/** A registered user as surfaced by search. */
export class PublicUserResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;
}

/** Response of `GET /users/:userId/profile`. */
export class UserProfileResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ type: String, nullable: true })
  statusMessage!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: '마지막 접속 시각',
  })
  lastSeenAt!: string | null;
}

/** Response of `GET /users/search`. */
export class PaginatedUsersResponse extends PaginatedResponse {
  @ApiProperty({ type: [PublicUserResponse] })
  items!: PublicUserResponse[];
}
