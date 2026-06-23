import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const log = new Logger('retryOnConflict');

// Postgres serialization/deadlock SQLSTATEs surfaced by Prisma.
const RETRYABLE_PG = new Set(['40001', '40P01']);

function isRetryable(err: unknown): boolean {
  // Our own "insufficient available stock" from the row-locked re-check: the
  // optimistic plan lost a race; re-running re-plans against fresh availability.
  if (err instanceof ConflictException) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2034') return true; // write conflict / deadlock
    const pg = (err.meta as { code?: string } | undefined)?.code;
    if (pg && RETRYABLE_PG.has(pg)) return true;
  }
  return false;
}

/**
 * Run `fn`, retrying when it fails on a *transient* contention conflict. Genuine
 * business errors (e.g. BadRequestException for a real network shortage) are not
 * retryable and propagate immediately. Each retry re-executes `fn` fully, which
 * — for sourcing/reservation — means it re-plans against current availability.
 */
export async function retryOnConflict<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 15;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts) throw err;
      // Jittered backoff to spread out colliding writers on a hot SKU.
      const delay = baseDelayMs * attempt + Math.floor(Math.random() * baseDelayMs);
      log.debug(
        `${opts.label ?? 'op'}: retryable conflict on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
