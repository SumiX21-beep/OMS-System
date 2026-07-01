import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

/**
 * Build ioredis connection options from config, shared by the ATP cache
 * (RedisService) and BullMQ (BullConfig) so both talk to the same instance.
 *
 * Prefers a full `REDIS_URL` (managed providers like Upstash / Render / Redis
 * Cloud hand you one) — `rediss://` enables TLS automatically. Falls back to
 * discrete `REDIS_HOST`/`REDIS_PORT` for local/docker.
 */
export function buildRedisOptions(config: ConfigService): RedisOptions {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 6379,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      // Managed Redis over rediss:// requires TLS.
      tls: u.protocol === 'rediss:' ? {} : undefined,
      // Required by BullMQ; harmless for the cache client.
      maxRetriesPerRequest: null,
    };
  }
  return {
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    maxRetriesPerRequest: null,
  };
}
