import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ExpireOneJobData,
  QUEUES,
  RESERVATION_JOBS,
} from '../common/queues/queue.constants';
import { ReservationService } from './reservations.service';

/**
 * Worker-process consumer for reservation TTLs. Handles both the per-reservation
 * delayed expiry job and the periodic safety-net sweep (enqueued by the scheduler).
 */
@Processor(QUEUES.RESERVATION)
export class ReservationProcessor extends WorkerHost {
  private readonly log = new Logger(ReservationProcessor.name);

  constructor(private readonly reservations: ReservationService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case RESERVATION_JOBS.EXPIRE_ONE: {
        const { reservationId } = job.data as ExpireOneJobData;
        const released = await this.reservations.release(
          reservationId,
          'EXPIRED',
        );
        return { reservationId, released };
      }
      case RESERVATION_JOBS.SWEEP: {
        const count = await this.reservations.sweepExpired();
        return { swept: count };
      }
      default:
        this.log.warn(`Unknown job ${job.name}`);
        return null;
    }
  }
}
