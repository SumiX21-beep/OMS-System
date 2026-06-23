import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import { AiService } from './ai.service';
import { DemandForecastService } from './demand-forecast.service';
import { AskDto, ForecastQueryDto } from './dto/ai.dto';

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly forecast: DemandForecastService,
  ) {}

  /** Whether the LLM assistant is configured (forecast works regardless). */
  @Get('status')
  status() {
    return { assistant: this.ai.enabled };
  }

  /** Natural-language question answered via tool-use over your OMS data. */
  @Post('ask')
  ask(@TenantId() tenantId: string, @Body() dto: AskDto) {
    return this.ai.ask(tenantId, dto.question);
  }

  /** Deterministic demand forecast (no API key required). */
  @Get('forecast')
  forecastSku(@TenantId() tenantId: string, @Query() q: ForecastQueryDto) {
    return this.forecast.forecastBySkuId(
      tenantId,
      q.skuId,
      q.horizonDays,
      q.lookbackDays,
    );
  }
}
