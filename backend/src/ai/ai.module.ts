import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { DemandForecastService } from './demand-forecast.service';

@Module({
  imports: [InventoryModule, AdminModule],
  controllers: [AiController],
  providers: [AiService, DemandForecastService],
})
export class AiModule {}
