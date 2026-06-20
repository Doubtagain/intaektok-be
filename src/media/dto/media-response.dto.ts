import { ApiProperty } from '@nestjs/swagger';

/** Response of `POST /media/upload-url`. */
export class UploadUrlResponse {
  @ApiProperty()
  mediaId!: string;

  @ApiProperty({ description: '업로드용 presigned PUT URL' })
  uploadUrl!: string;

  @ApiProperty({ description: '스토리지 객체 키' })
  storageKey!: string;
}

/** Response of `POST /media/:mediaId/complete` and `GET /media/:mediaId`. */
export class MediaResponse {
  @ApiProperty()
  mediaId!: string;

  @ApiProperty({ description: '다운로드(GET) URL' })
  url!: string;

  @ApiProperty({ type: String, nullable: true, description: '썸네일 URL(없으면 null)' })
  thumbnailUrl!: string | null;

  @ApiProperty({ example: 'image/gif' })
  mimeType!: string;

  @ApiProperty({ description: '자동재생 대상 여부(움짤/영상)' })
  isAnimated!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: '동영상/애니메이션 길이(ms)' })
  durationMs!: number | null;
}
