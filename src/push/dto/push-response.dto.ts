import { ApiProperty } from '@nestjs/swagger';

/** Response of `POST /push/tokens`. */
export class PushTokenResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  platform!: string;
}
