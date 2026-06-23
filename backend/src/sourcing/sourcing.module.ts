import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { SourcingController } from './sourcing.controller';
import { SourcingService } from './sourcing.service';
import { SourcingRuleController } from './sourcing-rule.controller';
import { SourcingRuleService } from './sourcing-rule.service';

@Module({
  imports: [InventoryModule, OrdersModule],
  controllers: [SourcingController, SourcingRuleController],
  providers: [SourcingService, SourcingRuleService],
  exports: [SourcingService],
})
export class SourcingModule {}
