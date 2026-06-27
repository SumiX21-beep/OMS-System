import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { MockWmsProvider } from './providers/mock-wms.provider';
import { ShipBobWmsProvider } from './providers/shipbob-wms.provider';
import { WMS_PROVIDERS } from './providers/wms-provider.interface';
import { ReturnsService } from './returns.service';
import { WmsService } from './wms.service';

@Module({
  imports: [InventoryModule, OrdersModule],
  controllers: [FulfillmentController],
  providers: [
    FulfillmentService,
    ReturnsService,
    WmsService,
    MockWmsProvider,
    ShipBobWmsProvider,
    {
      provide: WMS_PROVIDERS,
      inject: [MockWmsProvider, ShipBobWmsProvider],
      useFactory: (mock: MockWmsProvider, shipbob: ShipBobWmsProvider) => [
        mock,
        shipbob,
      ],
    },
  ],
  exports: [FulfillmentService, ReturnsService],
})
export class FulfillmentModule {}
