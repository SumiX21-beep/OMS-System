import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { QUEUES } from './common/queues/queue.constants';
import { SchedulerService } from './scheduler/scheduler.service';

/** Scheduler process: owns repeatable/cron jobs (producer only). */
@Module({
  imports: [
    CommonModule,
    BullModule.registerQueue(
      { name: QUEUES.RESERVATION },
      { name: QUEUES.SYNC },
      { name: QUEUES.RECONCILIATION },
    ),
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
