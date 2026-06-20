import { ApiProperty } from '@nestjs/swagger';

/** Response of `POST /profile` (onboarding) and `PATCH /profile`. */
export class ProfileResponse {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  nickname!: string;

  @ApiProperty({ type: String, nullable: true })
  statusMessage!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarMediaId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'null이면 온보딩 미완료',
  })
  onboardedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: String, nullable: true, description: '표시용 아바타 URL(없으면 null)' })
  avatarUrl!: string | null;
}
