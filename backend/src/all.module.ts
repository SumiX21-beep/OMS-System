import { Module } from '@nestjs/common';
import { AppModule } from './app.module';
import { SchedulerModule } from './scheduler.module';
import { WorkerModule } from './worker.module';

/**
 * Single-process deployment: HTTP API + BullMQ worker + scheduler in one Nest
 * app. All three share the same CommonModule instance (one Prisma client, one
 * Redis/Bull connection), so this is lighter than running three contexts.
 *
 * Intended for hosts that bill per process (e.g. a Render free web service).
 * For horizontal scale, keep running main.ts / main.worker.ts / main.scheduler.ts
 * as separate processes instead (see docker-compose.yml).
 */
@Module({
  imports: [AppModule, WorkerModule, SchedulerModule],
})
export class AllModule {}
