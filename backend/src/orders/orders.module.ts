import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../common/queues/queue.constants';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ReservationService } from './reservations.service';
import { OrderValidationService } from './validation.service';

@Module({
  imports: [
    InventoryModule,
    PaymentsModule,
    BullModule.registerQueue({ name: QUEUES.RESERVATION }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, ReservationService, OrderValidationService],
  exports: [OrdersService, ReservationService],
})
export class OrdersModule {}
