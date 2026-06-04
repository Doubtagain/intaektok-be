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
  @ApiProperty({ description: '카카오 SDK로 발급받은 액세스 토큰' })
  @IsString()
  kakaoAccessToken!: string;

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
