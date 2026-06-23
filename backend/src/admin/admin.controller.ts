import { Controller, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import { ReconciliationService } from './reconciliation.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  /** Report inventory drift (snapshot vs ledger-derived) for this tenant. */
  @Get('reconciliation')
  report(@TenantId() tenantId: string) {
    return this.reconciliation.reconcileTenant(tenantId, false);
  }

  /** Repair any drift by resetting snapshots to the ledger-derived truth. */
  @Post('reconciliation/repair')
  repair(@TenantId() tenantId: string) {
    return this.reconciliation.reconcileTenant(tenantId, true);
  }
}
