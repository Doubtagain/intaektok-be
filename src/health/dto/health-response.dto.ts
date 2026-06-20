import { ApiProperty } from '@nestjs/swagger';

/** Response of `GET /health` (liveness). */
export class HealthResponse {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

/** Response of `GET /ready` (readiness — DB + Redis reachable). */
export class ReadyResponse {
  @ApiProperty({ example: 'ready' })
  status!: string;

  @ApiProperty({ description: 'DB 연결 가능 여부' })
  db!: boolean;

  @ApiProperty({ description: 'Redis 연결 가능 여부' })
  redis!: boolean;
}
