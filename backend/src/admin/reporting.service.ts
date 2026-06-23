import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Read-only aggregate queries powering operational dashboards: order pipeline,
 * inventory health, fulfilment SLA, and sourcing decisions. All tenant-scoped.
 */
@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Order counts by status and by channel. */
  async orders(tenantId: string) {
    const [byStatus, byChannel, total] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.order.count({ where: { tenantId } }),
    ]);
    return {
      total,
      byStatus: this.toCountMap(byStatus, 'status'),
      byChannel: this.toCountMap(byChannel, 'channel'),
    };
  }

  /** Inventory health: network totals + SKUs/locations at or below threshold. */
  async inventory(tenantId: string, threshold = 5) {
    const snaps = await this.prisma.inventorySnapshot.findMany({
      where: { tenantId },
      include: {
        sku: { select: { code: true } },
        location: { select: { code: true } },
      },
    });

    const totals = { onHand: 0, reserved: 0, allocated: 0, available: 0 };
    const lowStock: {
      sku: string;
      location: string;
      available: number;
    }[] = [];

    for (const s of snaps) {
      const available = Math.max(
        0,
        s.onHand - s.reserved - s.allocated - s.safetyStock,
      );
      totals.onHand += s.onHand;
      totals.reserved += s.reserved;
      totals.allocated += s.allocated;
      totals.available += available;
      if (available <= threshold) {
        lowStock.push({
          sku: s.sku.code,
          location: s.location.code,
          available,
        });
      }
    }
    lowStock.sort((a, b) => a.available - b.available);
    return { totals, threshold, lowStockCount: lowStock.length, lowStock };
  }

  /** Fulfilment SLA: shipments by status + average created→shipped hours. */
  async fulfillment(tenantId: string) {
    const [byStatus, shipments] = await Promise.all([
      this.prisma.shipment.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.shipment.findMany({
        where: { tenantId, status: { in: ['SHIPPED', 'DELIVERED', 'PICKED_UP'] } },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    const durations = shipments.map(
      (s) => (s.updatedAt.getTime() - s.createdAt.getTime()) / 3_600_000,
    );
    const avgFulfillmentHours = durations.length
      ? Number(
          (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2),
        )
      : 0;

    return {
      shipmentsByStatus: this.toCountMap(byStatus, 'status'),
      fulfilledCount: shipments.length,
      avgFulfillmentHours,
    };
  }

  /** Sourcing decisions: shipments by fulfilment type + split-shipment rate. */
  async sourcing(tenantId: string) {
    const [byType, perOrder] = await Promise.all([
      this.prisma.shipment.groupBy({
        by: ['fulfillmentType'],
        where: { tenantId },
        _count: true,
      }),
      this.prisma.shipment.groupBy({
        by: ['orderId'],
        where: { tenantId },
        _count: true,
      }),
    ]);
    const sourcedOrders = perOrder.length;
    const splitOrders = perOrder.filter((o) => o._count > 1).length;
    return {
      shipmentsByFulfillmentType: this.toCountMap(byType, 'fulfillmentType'),
      sourcedOrders,
      splitOrders,
      splitRate: sourcedOrders
        ? Number((splitOrders / sourcedOrders).toFixed(3))
        : 0,
    };
  }

  private toCountMap<T extends { _count: number }>(
    rows: T[],
    key: keyof T,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
      out[String(r[key])] = r._count;
    }
    return out;
  }
}
