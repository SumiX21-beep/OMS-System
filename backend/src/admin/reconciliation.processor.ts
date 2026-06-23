import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUES,
  RECONCILIATION_JOBS,
} from '../common/queues/queue.constants';
import { ReconciliationService } from './reconciliation.service';

/** Periodic data-integrity job (report-only; repair is operator-triggered). */
@Processor(QUEUES.RECONCILIATION)
export class ReconciliationProcessor extends WorkerHost {
  private readonly log = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliation: ReconciliationService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === RECONCILIATION_JOBS.RECONCILE) {
      const report = await this.reconciliation.reconcileAll(false);
      return { checked: report.checked, drifted: report.drifted };
    }
    this.log.warn(`Unknown job ${job.name}`);
    return null;
  }
}
