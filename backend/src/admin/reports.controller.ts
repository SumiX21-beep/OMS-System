import { Controller, Get, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import { ReportingService } from './reporting.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('orders')
  orders(@TenantId() tenantId: string) {
    return this.reporting.orders(tenantId);
  }

  @Get('inventory')
  inventory(
    @TenantId() tenantId: string,
    @Query('threshold') threshold?: string,
  ) {
    return this.reporting.inventory(
      tenantId,
      threshold ? Number(threshold) : undefined,
    );
  }

  @Get('fulfillment')
  fulfillment(@TenantId() tenantId: string) {
    return this.reporting.fulfillment(tenantId);
  }

  @Get('sourcing')
  sourcing(@TenantId() tenantId: string) {
    return this.reporting.sourcing(tenantId);
  }
}
