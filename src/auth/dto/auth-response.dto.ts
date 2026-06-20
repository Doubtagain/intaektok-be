import { ApiProperty } from '@nestjs/swagger';

/** Response of `POST /auth/refresh` (and the token half of login). */
export class TokenPairResponse {
  @ApiProperty({ description: '액세스 토큰(JWT)' })
  accessToken!: string;

  @ApiProperty({ description: '리프레시 토큰(JWT, 회전 대상)' })
  refreshToken!: string;
}

export class LoginUserResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '카카오 회원번호' })
  kakaoId!: string;
}

/** Response of `POST /auth/kakao`. */
export class LoginResponse extends TokenPairResponse {
  @ApiProperty({ type: LoginUserResponse })
  user!: LoginUserResponse;

  @ApiProperty({ description: '온보딩(프로필 생성) 완료 여부' })
  isOnboarded!: boolean;
}

export class MeProfileResponse {
  @ApiProperty()
  nickname!: string;

  @ApiProperty({ type: String, nullable: true })
  statusMessage!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarMediaId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '표시용 아바타 URL(없으면 null)' })
  avatarUrl!: string | null;
}

/** Response of `GET /auth/me`. */
export class MeResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: '카카오 회원번호' })
  kakaoId!: string;

  @ApiProperty()
  isOnboarded!: boolean;

  @ApiProperty({
    type: MeProfileResponse,
    nullable: true,
    description: '온보딩 전이면 null',
  })
  profile!: MeProfileResponse | null;
}
