import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { ReturnsService } from './returns.service';
import { WmsService } from './wms.service';

@Module({
  imports: [InventoryModule, OrdersModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, ReturnsService, WmsService],
  exports: [FulfillmentService, ReturnsService],
})
export class FulfillmentModule {}
