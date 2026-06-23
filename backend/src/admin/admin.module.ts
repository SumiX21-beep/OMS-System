import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReportingService } from './reporting.service';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [AdminController, ReportsController],
  providers: [ReconciliationService, ReportingService],
  exports: [ReconciliationService, ReportingService],
})
export class AdminModule {}
