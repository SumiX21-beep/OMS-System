import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';

/** Health, metrics, and the request-logging interceptor's metrics sink. */
@Global()
@Module({
  controllers: [HealthController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
