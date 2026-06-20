import { ApiProperty } from '@nestjs/swagger';
import { WhitelistStatus } from '@prisma/client';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

/** A whitelist row as returned by create/list/update. */
export class WhitelistResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: '카카오 회원번호' })
  kakaoId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '대체 식별자(이메일/전화 등)' })
  identifier!: string | null;

  @ApiProperty({ enum: WhitelistStatus })
  status!: WhitelistStatus;

  @ApiProperty({ type: String, nullable: true, description: '초대한 사용자 id' })
  invitedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** Response of `GET /admin/whitelist`. */
export class PaginatedWhitelistResponse extends PaginatedResponse {
  @ApiProperty({ type: [WhitelistResponse] })
  items!: WhitelistResponse[];
}
