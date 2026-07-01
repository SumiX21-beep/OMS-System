import { SharedBullConfigurationFactory } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueOptions } from 'bullmq';
import { buildRedisOptions } from '../redis/redis-connection';

@Injectable()
export class BullConfig implements SharedBullConfigurationFactory {
  constructor(private readonly config: ConfigService) {}

  createSharedConfiguration(): QueueOptions {
    return {
      connection: buildRedisOptions(this.config),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    };
  }
}
