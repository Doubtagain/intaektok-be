import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class DeviceDto {
  @ApiPropertyOptional({ example: 'iPhone 15' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: string;
}

export class KakaoLoginDto {
  @ApiProperty({
    description:
      '카카오 로그인 리다이렉트 콜백으로 받은 인가 코드(authorization code). ' +
      '백엔드가 앱 시크릿과 함께 카카오 서버에 제출해 액세스 토큰으로 교환합니다.',
  })
  @IsString()
  code!: string;

  @ApiProperty({
    description:
      '인가 코드를 발급받을 때 사용한 redirect_uri. 카카오 토큰 교환 시 ' +
      '바이트 단위로 동일해야 합니다.',
    example: 'https://intaektalk.app/oauth/kakao/callback',
  })
  @IsString()
  redirectUri!: string;

  @ApiPropertyOptional({ type: DeviceDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => DeviceDto)
  device?: DeviceDto;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}
