import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ReconciliationProcessor } from './admin/reconciliation.processor';
import { CommonModule } from './common/common.module';
import { QUEUES } from './common/queues/queue.constants';
import { OrdersModule } from './orders/orders.module';
import { ReservationProcessor } from './orders/reservation.processor';
import { SyncModule } from './sync/sync.module';
import { SyncProcessor } from './sync/sync.processor';

/**
 * Worker process: consumes BullMQ jobs — reservation TTL expiry/sweeps, outbox
 * drain to channels, and periodic reconciliation. Queues must be registered
 * here so the BullMQ explorer binds each @Processor to a consumer.
 */
@Module({
  imports: [
    CommonModule,
    OrdersModule,
    SyncModule,
    AdminModule,
    BullModule.registerQueue(
      { name: QUEUES.RESERVATION },
      { name: QUEUES.SYNC },
      { name: QUEUES.RECONCILIATION },
    ),
  ],
  providers: [ReservationProcessor, SyncProcessor, ReconciliationProcessor],
})
export class WorkerModule {}
