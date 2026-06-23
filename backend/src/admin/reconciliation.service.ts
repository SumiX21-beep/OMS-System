import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';

interface Buckets {
  onHand: number;
  reserved: number;
  allocated: number;
  inTransit: number;
  damaged: number;
}

export interface DriftEntry {
  skuId: string;
  locationId: string;
  snapshot: Buckets;
  derived: Buckets;
  diff: Partial<Buckets>;
}

export interface ReconciliationReport {
  checked: number;
  drifted: number;
  repaired: number;
  entries: DriftEntry[];
}

const ZERO: Buckets = {
  onHand: 0,
  reserved: 0,
  allocated: 0,
  inTransit: 0,
  damaged: 0,
};

/**
 * Data-integrity guard. Because InventoryLedger is the append-only truth, the
 * snapshot must always equal the running sum of ledger deltas. This re-derives
 * that sum and reports — or optionally repairs — any divergence (safetyStock is
 * config, not ledger-derived, so it's excluded).
 */
@Injectable()
export class ReconciliationService {
  private readonly log = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  reconcileTenant(tenantId: string, repair = false): Promise<ReconciliationReport> {
    return this.run({ tenantId }, repair);
  }

  /** Cross-tenant pass for the scheduled integrity job (report-only by default). */
  reconcileAll(repair = false): Promise<ReconciliationReport> {
    return this.run({}, repair);
  }

  private async run(
    where: { tenantId?: string },
    repair: boolean,
  ): Promise<ReconciliationReport> {
    const sums = await this.prisma.inventoryLedger.groupBy({
      by: ['skuId', 'locationId'],
      where,
      _sum: {
        onHandDelta: true,
        reservedDelta: true,
        allocatedDelta: true,
        inTransitDelta: true,
        damagedDelta: true,
      },
    });
    const derivedMap = new Map<string, Buckets>();
    for (const s of sums) {
      derivedMap.set(`${s.skuId}:${s.locationId}`, {
        onHand: s._sum.onHandDelta ?? 0,
        reserved: s._sum.reservedDelta ?? 0,
        allocated: s._sum.allocatedDelta ?? 0,
        inTransit: s._sum.inTransitDelta ?? 0,
        damaged: s._sum.damagedDelta ?? 0,
      });
    }

    const snapshots = await this.prisma.inventorySnapshot.findMany({ where });

    const entries: DriftEntry[] = [];
    let repaired = 0;

    for (const snap of snapshots) {
      const key = `${snap.skuId}:${snap.locationId}`;
      const derived = derivedMap.get(key) ?? ZERO;
      const current: Buckets = {
        onHand: snap.onHand,
        reserved: snap.reserved,
        allocated: snap.allocated,
        inTransit: snap.inTransit,
        damaged: snap.damaged,
      };

      const diff = this.diff(current, derived);
      if (Object.keys(diff).length === 0) continue;

      entries.push({
        skuId: snap.skuId,
        locationId: snap.locationId,
        snapshot: current,
        derived,
        diff,
      });

      if (repair) {
        await this.prisma.inventorySnapshot.update({
          where: { id: snap.id },
          data: { ...derived, version: { increment: 1 } },
        });
        await this.redis.delPattern(`atp:${snap.tenantId}:${snap.skuId}:*`);
        repaired++;
      }
    }

    const report: ReconciliationReport = {
      checked: snapshots.length,
      drifted: entries.length,
      repaired,
      entries,
    };
    if (entries.length) {
      this.log.warn(
        `Reconciliation: ${entries.length}/${snapshots.length} drifted${
          repair ? `, ${repaired} repaired` : ''
        }`,
      );
    }
    return report;
  }

  private diff(a: Buckets, b: Buckets): Partial<Buckets> {
    const out: Partial<Buckets> = {};
    (Object.keys(a) as (keyof Buckets)[]).forEach((k) => {
      if (a[k] !== b[k]) out[k] = b[k] - a[k];
    });
    return out;
  }
}
