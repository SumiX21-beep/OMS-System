import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES, SYNC_JOBS } from '../common/queues/queue.constants';
import { SyncService } from './sync.service';

/** Worker-process consumer that drains the outbox to sales channels. */
@Processor(QUEUES.SYNC)
export class SyncProcessor extends WorkerHost {
  private readonly log = new Logger(SyncProcessor.name);

  constructor(private readonly sync: SyncService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === SYNC_JOBS.DRAIN_OUTBOX) {
      const published = await this.sync.drainOutbox();
      return { published };
    }
    this.log.warn(`Unknown job ${job.name}`);
    return null;
  }
}
