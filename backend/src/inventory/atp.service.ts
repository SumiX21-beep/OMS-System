import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AvailabilityView } from './inventory.types';

/**
 * Read side of inventory: computes Available-to-Promise from the derived
 * snapshots and caches the answer in Redis for sub-ms storefront reads.
 *
 *   available           = onHand - reserved - allocated - safetyStock   (>= 0)
 *   availableToPromise  = available + inbound (in-transit within horizon)
 */
@Injectable()
export class AtpService {
  private readonly cacheTtl: number;
  private readonly horizonDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.cacheTtl = config.get<number>('ATP_CACHE_TTL_SECONDS', 30);
    // Inbound stock counts toward ATP only if it arrives within this many days
    // (0 = exclude inbound entirely). Driven by the Inbound table's ETAs.
    this.horizonDays = config.get<number>('ATP_INBOUND_HORIZON_DAYS', 7);
  }

  /** Per-location availability for a SKU (cached). */
  async atLocation(
    tenantId: string,
    skuId: string,
    locationId: string,
  ): Promise<AvailabilityView> {
    const key = `atp:${tenantId}:${skuId}:${locationId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as AvailabilityView;

    const snap = await this.prisma.inventorySnapshot.findUnique({
      where: {
        tenantId_skuId_locationId: { tenantId, skuId, locationId },
      },
    });
    const inbound = await this.inboundWithinHorizon(tenantId, skuId, locationId);
    const view = this.compose(skuId, locationId, this.buckets(snap), inbound);
    await this.redis.setEx(key, JSON.stringify(view), this.cacheTtl);
    return view;
  }

  /** Network-wide rollup across all active locations (cached). */
  async network(tenantId: string, skuId: string): Promise<AvailabilityView> {
    const key = `atp:${tenantId}:${skuId}:network`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as AvailabilityView;

    const snaps = await this.prisma.inventorySnapshot.findMany({
      where: { tenantId, skuId, location: { active: true } },
    });
    const agg = snaps.reduce((acc, s) => this.addBuckets(acc, s), this.zero());
    const inbound = await this.inboundWithinHorizon(tenantId, skuId);
    const view = this.compose(skuId, null, agg, inbound);
    await this.redis.setEx(key, JSON.stringify(view), this.cacheTtl);
    return view;
  }

  /** Breakdown per location for "in stock at N stores near you" style reads. */
  async breakdown(
    tenantId: string,
    skuId: string,
  ): Promise<AvailabilityView[]> {
    const snaps = await this.prisma.inventorySnapshot.findMany({
      where: { tenantId, skuId, location: { active: true } },
    });
    return Promise.all(
      snaps.map(async (s) =>
        this.compose(
          skuId,
          s.locationId,
          this.buckets(s),
          await this.inboundWithinHorizon(tenantId, skuId, s.locationId),
        ),
      ),
    );
  }

  /** Remaining inbound quantity expected within the ATP horizon. */
  private async inboundWithinHorizon(
    tenantId: string,
    skuId: string,
    locationId?: string,
  ): Promise<number> {
    if (this.horizonDays <= 0) return 0;
    const horizonDate = new Date(
      Date.now() + this.horizonDays * 24 * 60 * 60 * 1000,
    );
    const agg = await this.prisma.inbound.aggregate({
      _sum: { quantity: true, receivedQty: true },
      where: {
        tenantId,
        skuId,
        ...(locationId ? { locationId } : {}),
        status: 'EXPECTED',
        expectedAt: { lte: horizonDate },
      },
    });
    return (agg._sum.quantity ?? 0) - (agg._sum.receivedQty ?? 0);
  }

  private compose(
    skuId: string,
    locationId: string | null,
    b: Buckets,
    inboundForAtp: number,
  ): AvailabilityView {
    const available = Math.max(
      0,
      b.onHand - b.reserved - b.allocated - b.safetyStock,
    );
    return {
      skuId,
      locationId,
      onHand: b.onHand,
      reserved: b.reserved,
      allocated: b.allocated,
      inTransit: b.inTransit,
      damaged: b.damaged,
      safetyStock: b.safetyStock,
      available,
      // Near-term inbound (within horizon) adds to what we can promise.
      availableToPromise: available + Math.max(0, inboundForAtp),
    };
  }

  private buckets(snap: Buckets | null): Buckets {
    return snap ? this.addBuckets(this.zero(), snap) : this.zero();
  }

  private zero(): Buckets {
    return {
      onHand: 0,
      reserved: 0,
      allocated: 0,
      inTransit: 0,
      damaged: 0,
      safetyStock: 0,
    };
  }

  private addBuckets(acc: Buckets, s: Buckets): Buckets {
    acc.onHand += s.onHand;
    acc.reserved += s.reserved;
    acc.allocated += s.allocated;
    acc.inTransit += s.inTransit;
    acc.damaged += s.damaged;
    acc.safetyStock += s.safetyStock;
    return acc;
  }
}

interface Buckets {
  onHand: number;
  reserved: number;
  allocated: number;
  inTransit: number;
  damaged: number;
  safetyStock: number;
}
