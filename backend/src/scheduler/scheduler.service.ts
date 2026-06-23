import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  QUEUES,
  RECONCILIATION_JOBS,
  RESERVATION_JOBS,
  SYNC_JOBS,
} from '../common/queues/queue.constants';

/**
 * Registers repeatable jobs on boot:
 *   • reservation sweep — release reservations past TTL,
 *   • outbox drain — push changed ATP to channels,
 *   • reconciliation — periodic ledger-vs-snapshot integrity check.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUES.RESERVATION) private readonly reservationQueue: Queue,
    @InjectQueue(QUEUES.SYNC) private readonly syncQueue: Queue,
    @InjectQueue(QUEUES.RECONCILIATION) private readonly reconQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const sweepEvery = this.config.get<number>(
      'RESERVATION_SWEEP_INTERVAL_MS',
      60000,
    );
    const drainEvery = this.config.get<number>('SYNC_DRAIN_INTERVAL_MS', 10000);
    const reconEvery = this.config.get<number>(
      'RECONCILE_INTERVAL_MS',
      300000,
    );

    // Use the modern Job Scheduler API (the legacy `repeat` option on add() does
    // not reliably promote delayed jobs in current BullMQ).
    await this.reservationQueue.upsertJobScheduler(
      'reservation-sweep',
      { every: sweepEvery },
      { name: RESERVATION_JOBS.SWEEP, data: {} },
    );
    await this.syncQueue.upsertJobScheduler(
      'sync-drain',
      { every: drainEvery },
      { name: SYNC_JOBS.DRAIN_OUTBOX, data: {} },
    );
    await this.reconQueue.upsertJobScheduler(
      'reconcile',
      { every: reconEvery },
      { name: RECONCILIATION_JOBS.RECONCILE, data: {} },
    );

    this.log.log(
      `Scheduled: sweep=${sweepEvery}ms, drain=${drainEvery}ms, reconcile=${reconEvery}ms`,
    );
  }
}
