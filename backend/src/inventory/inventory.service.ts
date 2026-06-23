import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InventoryEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { RedisService } from '../common/redis/redis.service';
import { EventsService } from '../events/events.service';
import { MovementParams, SnapshotRow } from './inventory.types';

/**
 * Owns all writes to inventory. Every mutation is applied inside a transaction
 * that:
 *   1. locks the (sku, location) snapshot row with SELECT ... FOR UPDATE,
 *   2. validates the resulting balances (no negative buckets; no oversell),
 *   3. updates the snapshot (bumping `version`),
 *   4. appends an immutable InventoryLedger event,
 *   5. invalidates the ATP cache for the SKU.
 *
 * The row lock serialises concurrent movements on the same hot SKU/location,
 * which is what prevents two orders from allocating the same last unit.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: EventsService,
  ) {}

  // ── Public movement primitives ────────────────────────────────────────────

  receive(p: Base & { quantity: number; reason?: string }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.RECEIPT,
      deltas: { onHand: p.quantity },
      reason: p.reason,
    });
  }

  /** Signed correction to on-hand (cycle counts, shrinkage). */
  adjust(p: Base & { delta: number; reason?: string }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.ADJUSTMENT,
      deltas: { onHand: p.delta },
      reason: p.reason,
    });
  }

  reserve(p: Ref & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.RESERVE,
      deltas: { reserved: p.quantity },
      requireAvailable: true,
    });
  }

  releaseReserve(p: Ref & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.RELEASE_RESERVE,
      deltas: { reserved: -p.quantity },
    });
  }

  /** Hard-commit free stock straight to an order (no prior reservation). */
  allocate(p: Ref & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.ALLOCATE,
      deltas: { allocated: p.quantity },
      requireAvailable: true,
    });
  }

  deallocate(p: Ref & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.DEALLOCATE,
      deltas: { allocated: -p.quantity },
    });
  }

  /** Harden an existing reservation into an allocation (availability unchanged). */
  convertReserveToAllocation(p: Ref & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.CONVERT_RESERVE_TO_ALLOC,
      deltas: { reserved: -p.quantity, allocated: p.quantity },
    });
  }

  ship(p: Ref & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.SHIP,
      deltas: { onHand: -p.quantity, allocated: -p.quantity },
    });
  }

  returnStock(p: Base & { quantity: number; reason?: string }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.RETURN,
      deltas: { onHand: p.quantity },
      reason: p.reason,
    });
  }

  createInbound(p: Base & { quantity: number; reason?: string }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.INBOUND_CREATE,
      deltas: { inTransit: p.quantity },
      reason: p.reason,
    });
  }

  arriveInbound(p: Base & { quantity: number }) {
    return this.apply({
      ...p,
      eventType: InventoryEventType.INBOUND_ARRIVE,
      deltas: { inTransit: -p.quantity, onHand: p.quantity },
    });
  }

  // ── Core apply ──────────────────────────────────────────────────────────--

  /**
   * Apply a movement, optionally inside an existing transaction. When orders
   * reserve/allocate multiple lines atomically they pass their own `tx`.
   */
  async apply(
    params: MovementParams,
    tx?: Prisma.TransactionClient,
  ): Promise<SnapshotRow> {
    if (tx) return this.applyWithin(tx, params);
    const result = await this.prisma.$transaction((t) =>
      this.applyWithin(t, params),
    );
    await this.invalidate(params.tenantId, params.skuId);
    return result;
  }

  private async applyWithin(
    tx: Prisma.TransactionClient,
    params: MovementParams,
  ): Promise<SnapshotRow> {
    const { tenantId, skuId, locationId, deltas } = params;

    // Ensure the snapshot row exists so we have something to lock. Insert is a
    // no-op when it already exists.
    await tx.$executeRaw`
      INSERT INTO "InventorySnapshot"
        ("id","tenantId","skuId","locationId","updatedAt")
      VALUES (${randomUUID()}, ${tenantId}, ${skuId}, ${locationId}, now())
      ON CONFLICT ("tenantId","skuId","locationId") DO NOTHING
    `;

    // Lock the row for the duration of the transaction.
    const rows = await tx.$queryRaw<SnapshotRow[]>`
      SELECT "id","onHand","reserved","allocated","inTransit","damaged","safetyStock","version"
      FROM "InventorySnapshot"
      WHERE "tenantId" = ${tenantId} AND "skuId" = ${skuId} AND "locationId" = ${locationId}
      FOR UPDATE
    `;
    const current = rows[0];
    if (!current) {
      // Should be impossible after the upsert above.
      throw new NotFoundException('Snapshot row missing after upsert');
    }

    const next: SnapshotRow = {
      ...current,
      onHand: current.onHand + (deltas.onHand ?? 0),
      reserved: current.reserved + (deltas.reserved ?? 0),
      allocated: current.allocated + (deltas.allocated ?? 0),
      inTransit: current.inTransit + (deltas.inTransit ?? 0),
      damaged: current.damaged + (deltas.damaged ?? 0),
    };

    this.validate(next, params);

    await tx.$executeRaw`
      UPDATE "InventorySnapshot"
      SET "onHand" = ${next.onHand},
          "reserved" = ${next.reserved},
          "allocated" = ${next.allocated},
          "inTransit" = ${next.inTransit},
          "damaged" = ${next.damaged},
          "version" = ${current.version + 1},
          "updatedAt" = now()
      WHERE "id" = ${current.id}
    `;

    await tx.inventoryLedger.create({
      data: {
        tenantId,
        skuId,
        locationId,
        eventType: params.eventType,
        onHandDelta: deltas.onHand ?? 0,
        reservedDelta: deltas.reserved ?? 0,
        allocatedDelta: deltas.allocated ?? 0,
        inTransitDelta: deltas.inTransit ?? 0,
        damagedDelta: deltas.damaged ?? 0,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        reason: params.reason,
      },
    });

    return { ...next, version: current.version + 1 };
  }

  private validate(next: SnapshotRow, params: MovementParams): void {
    const negative = (
      ['onHand', 'reserved', 'allocated', 'inTransit', 'damaged'] as const
    ).find((b) => next[b] < 0);
    if (negative) {
      throw new ConflictException(
        `Movement ${params.eventType} would drive ${negative} negative for sku ${params.skuId} @ ${params.locationId}`,
      );
    }

    if (params.requireAvailable) {
      const available =
        next.onHand - next.reserved - next.allocated - next.safetyStock;
      if (available < 0) {
        throw new ConflictException(
          `Insufficient available stock for sku ${params.skuId} @ ${params.locationId} (short by ${-available})`,
        );
      }
    }
  }

  /**
   * Move sellable on-hand between two locations atomically. The source leg
   * requires availability (won't move reserved/allocated stock); both legs are
   * written in one transaction so a transfer can never lose or duplicate units.
   */
  async transfer(p: {
    tenantId: string;
    skuId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    reason?: string;
  }): Promise<void> {
    if (p.fromLocationId === p.toLocationId) {
      throw new ConflictException('Source and destination must differ');
    }
    if (p.quantity <= 0) {
      throw new ConflictException('Transfer quantity must be positive');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.applyWithin(tx, {
        tenantId: p.tenantId,
        skuId: p.skuId,
        locationId: p.fromLocationId,
        eventType: InventoryEventType.TRANSFER_OUT,
        deltas: { onHand: -p.quantity },
        requireAvailable: true,
        referenceType: 'transfer',
        referenceId: p.toLocationId,
        reason: p.reason,
      });
      await this.applyWithin(tx, {
        tenantId: p.tenantId,
        skuId: p.skuId,
        locationId: p.toLocationId,
        eventType: InventoryEventType.TRANSFER_IN,
        deltas: { onHand: p.quantity },
        referenceType: 'transfer',
        referenceId: p.fromLocationId,
        reason: p.reason,
      });
    });
    await this.invalidate(p.tenantId, p.skuId);
  }

  /** Set the safety-stock buffer for a (sku, location). Does not write a ledger event. */
  async setSafetyStock(p: Base & { safetyStock: number }): Promise<void> {
    await this.prisma.inventorySnapshot.upsert({
      where: {
        tenantId_skuId_locationId: {
          tenantId: p.tenantId,
          skuId: p.skuId,
          locationId: p.locationId,
        },
      },
      create: {
        tenantId: p.tenantId,
        skuId: p.skuId,
        locationId: p.locationId,
        safetyStock: p.safetyStock,
      },
      update: { safetyStock: p.safetyStock },
    });
    await this.invalidate(p.tenantId, p.skuId);
  }

  /** Paginated snapshot list (with derived available) for the console. */
  async listSnapshots(
    tenantId: string,
    q: {
      skuId?: string;
      locationId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.InventorySnapshotWhereInput = {
      tenantId,
      ...(q.skuId ? { skuId: q.skuId } : {}),
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.search
        ? { sku: { code: { contains: q.search, mode: 'insensitive' } } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.inventorySnapshot.findMany({
        where,
        skip,
        take,
        orderBy: [{ skuId: 'asc' }, { locationId: 'asc' }],
        include: {
          sku: { select: { code: true, name: true } },
          location: { select: { code: true, name: true } },
        },
      }),
      this.prisma.inventorySnapshot.count({ where }),
    ]);
    const items = rows.map((s) => ({
      ...s,
      available: Math.max(
        0,
        s.onHand - s.reserved - s.allocated - s.safetyStock,
      ),
    }));
    return makePage(items, total, page, pageSize);
  }

  async invalidate(tenantId: string, skuId: string): Promise<void> {
    await this.redis.delPattern(`atp:${tenantId}:${skuId}:*`);
    // Record an outbox event so the sync worker can push the new ATP to
    // channels (and StockShield can page deltas). Best-effort: the canonical
    // /sync/inventory feed remains correct even if this row is ever missed.
    try {
      await this.prisma.outboxEvent.create({
        data: {
          tenantId,
          type: 'INVENTORY_ATP_CHANGED',
          subjectId: skuId,
          payload: { skuId },
        },
      });
    } catch {
      // Never let sync bookkeeping fail an inventory operation.
    }
    // Notify live UI subscribers that this SKU's availability changed.
    this.events.publish({
      tenantId,
      type: 'inventory.atp',
      subjectId: skuId,
    });
  }
}

interface Base {
  tenantId: string;
  skuId: string;
  locationId: string;
}

interface Ref extends Base {
  referenceType?: string;
  referenceId?: string;
  reason?: string;
}
