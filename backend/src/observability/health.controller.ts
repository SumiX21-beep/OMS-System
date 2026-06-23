import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { MetricsService } from './metrics.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  /** Liveness/readiness: verifies Postgres and Redis are reachable. */
  @Get('health')
  async health() {
    const checks = { database: false, redis: false };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      /* leave false */
    }
    try {
      checks.redis = (await this.redis.client.ping()) === 'PONG';
    } catch {
      /* leave false */
    }
    const ok = checks.database && checks.redis;
    if (!ok) throw new ServiceUnavailableException({ status: 'down', checks });
    return { status: 'ok', checks };
  }

  /** Prometheus metrics scrape. */
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  metricsScrape(): string {
    return this.metrics.render();
  }
}
