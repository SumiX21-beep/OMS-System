import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface IdempotentResult<T> {
  body: T;
  replayed: boolean;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  static hash(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload ?? null))
      .digest('hex');
  }

  /**
   * Runs `fn` at most once per (tenant, scope, key). On replay with the same
   * request body, returns the stored response. A replay with a *different* body
   * for the same key is rejected (the classic idempotency-key contract).
   */
  async run<T>(
    tenantId: string,
    scope: string,
    key: string | undefined,
    request: unknown,
    fn: () => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    if (!key) {
      return { body: await fn(), replayed: false };
    }

    const requestHash = IdempotencyService.hash(request);

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { tenantId_scope_key: { tenantId, scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          `Idempotency key "${key}" was already used with a different request body`,
        );
      }
      return { body: existing.responseBody as T, replayed: true };
    }

    const body = await fn();

    // Normalise to plain JSON (Date -> ISO string, drop undefined) so it fits a
    // Prisma Json column; the replay returns this same normalised shape.
    const responseBody = JSON.parse(
      JSON.stringify(body ?? null),
    ) as Prisma.InputJsonValue;

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          tenantId,
          scope,
          key,
          requestHash,
          responseBody,
        },
      });
    } catch (err) {
      // Lost a race with a concurrent identical request: fall back to stored.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.idempotencyKey.findUnique({
          where: { tenantId_scope_key: { tenantId, scope, key } },
        });
        if (winner) return { body: winner.responseBody as T, replayed: true };
      }
      throw err;
    }

    return { body, replayed: false };
  }
}
