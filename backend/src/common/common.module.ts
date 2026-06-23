import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CryptoModule } from './crypto/crypto.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { PrismaModule } from './prisma/prisma.module';
import { BullConfig } from './queues/bull.config';
import { RedisModule } from './redis/redis.module';

/**
 * Shared infrastructure wired once and reused by every process (API, worker,
 * scheduler): config, Prisma, Redis, idempotency and the BullMQ root connection.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    IdempotencyModule,
    BullModule.forRootAsync({ useClass: BullConfig }),
  ],
  providers: [BullConfig],
  exports: [PrismaModule, RedisModule, CryptoModule, IdempotencyModule, BullModule],
})
export class CommonModule {}
