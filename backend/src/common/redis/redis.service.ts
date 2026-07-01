import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { buildRedisOptions } from './redis-connection';

/**
 * Thin wrapper over an ioredis connection used for the ATP availability cache.
 * BullMQ creates its own connections via the queue config.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(buildRedisOptions(config));
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  /** Delete by glob pattern using a non-blocking SCAN. */
  async delPattern(pattern: string): Promise<void> {
    const stream = this.client.scanStream({ match: pattern, count: 200 });
    const pipeline = this.client.pipeline();
    let queued = 0;
    for await (const keys of stream) {
      for (const key of keys as string[]) {
        pipeline.del(key);
        queued++;
      }
    }
    if (queued) await pipeline.exec();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
