import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponse, ReadyResponse } from './dto/health-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Errors } from '../common/errors';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness' })
  @ApiOkResponse({ type: HealthResponse })
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness (DB + Redis 연결 확인)' })
  @ApiOkResponse({ type: ReadyResponse })
  async ready() {
    const checks = { db: false, redis: false };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {
      /* db down */
    }
    try {
      checks.redis = (await this.redis.raw.ping()) === 'PONG';
    } catch {
      /* redis down */
    }
    if (!checks.db || !checks.redis) {
      throw Errors.internal('서비스가 아직 준비되지 않았습니다.', checks);
    }
    return { status: 'ready', ...checks };
  }
}
