import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

/** A pending login attempt awaiting admin approval. */
export class AccessRequestResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '로그인 시도에서 확보한 카카오 회원번호' })
  kakaoId!: string;

  @ApiProperty({ type: String, nullable: true, description: '카카오 프로필 닉네임' })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true })
  profileImageUrl!: string | null;

  @ApiProperty({ description: '누적 로그인 시도 횟수' })
  attempts!: number;

  @ApiProperty({ format: 'date-time', description: '최초 시도 시각' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', description: '마지막 시도 시각' })
  lastAttemptAt!: string;
}

/** Response of `GET /admin/access-requests`. */
export class PaginatedAccessRequestsResponse extends PaginatedResponse {
  @ApiProperty({ type: [AccessRequestResponse] })
  items!: AccessRequestResponse[];
}
