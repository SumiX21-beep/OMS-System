import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AtpService } from '../inventory/atp.service';

export interface Forecast {
  skuId: string;
  skuCode: string;
  lookbackDays: number;
  horizonDays: number;
  totalShipped: number;
  avgDailyDemand: number;
  available: number;
  daysOfCover: number | null; // null = effectively infinite (no demand)
  forecastDemand: number; // expected units shipped over the horizon
  reorderSuggested: boolean;
  suggestedReorderQty: number;
}

/**
 * Deterministic demand forecast from the inventory ledger's SHIP history.
 * No external dependency — a moving-average projection plus days-of-cover and a
 * reorder suggestion. Also exposed to the AI assistant as a callable tool.
 */
@Injectable()
export class DemandForecastService {
  // Days of supply we want on hand before the next replenishment lands.
  private readonly leadTimeDays = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly atp: AtpService,
  ) {}

  async forecastBySkuId(
    tenantId: string,
    skuId: string,
    horizonDays = 14,
    lookbackDays = 30,
  ): Promise<Forecast> {
    const sku = await this.prisma.sku.findFirst({
      where: { id: skuId, tenantId },
      select: { id: true, code: true },
    });
    if (!sku) throw new NotFoundException(`SKU ${skuId} not found`);
    return this.compute(tenantId, sku.id, sku.code, horizonDays, lookbackDays);
  }

  async forecastBySkuCode(
    tenantId: string,
    skuCode: string,
    horizonDays = 14,
    lookbackDays = 30,
  ): Promise<Forecast> {
    const sku = await this.prisma.sku.findFirst({
      where: { tenantId, code: skuCode },
      select: { id: true, code: true },
    });
    if (!sku) throw new NotFoundException(`SKU "${skuCode}" not found`);
    return this.compute(tenantId, sku.id, sku.code, horizonDays, lookbackDays);
  }

  private async compute(
    tenantId: string,
    skuId: string,
    skuCode: string,
    horizonDays: number,
    lookbackDays: number,
  ): Promise<Forecast> {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    // SHIP events carry a negative onHandDelta; demand = units that shipped out.
    const agg = await this.prisma.inventoryLedger.aggregate({
      _sum: { onHandDelta: true },
      where: {
        tenantId,
        skuId,
        eventType: 'SHIP',
        createdAt: { gte: since },
      },
    });
    const totalShipped = -(agg._sum.onHandDelta ?? 0);
    const avgDailyDemand = round(totalShipped / lookbackDays);

    const { available } = await this.atp.network(tenantId, skuId);
    const daysOfCover =
      avgDailyDemand > 0 ? round(available / avgDailyDemand) : null;
    const forecastDemand = Math.round(avgDailyDemand * horizonDays);

    // Reorder if projected cover won't outlast the replenishment lead time.
    const reorderSuggested =
      daysOfCover !== null && daysOfCover < this.leadTimeDays;
    const targetStock = Math.ceil(avgDailyDemand * this.leadTimeDays);
    const suggestedReorderQty = reorderSuggested
      ? Math.max(0, targetStock - available)
      : 0;

    return {
      skuId,
      skuCode,
      lookbackDays,
      horizonDays,
      totalShipped,
      avgDailyDemand,
      available,
      daysOfCover,
      forecastDemand,
      reorderSuggested,
      suggestedReorderQty,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
