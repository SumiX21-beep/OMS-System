import { Controller, Param, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import { SourcingService } from './sourcing.service';

@Controller('orders')
export class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  /** Run the DOM sourcing engine: VALIDATED → ALLOCATED with split shipments. */
  @Post(':id/source')
  source(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.sourcing.sourceOrder(tenantId, id);
  }
}
