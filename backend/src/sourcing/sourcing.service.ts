import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AllocationStatus,
  FulfillmentType,
  LocationType,
  Order,
  OrderStatus,
  Prisma,
  ReservationStatus,
  SourcingStrategy,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { retryOnConflict } from '../common/retry.util';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { haversineKm } from './geo.util';

interface Candidate {
  locationId: string;
  type: LocationType;
  available: number;
  priority: number;
  distanceKm: number | null;
}

interface PlanLeg {
  locationId: string;
  quantity: number;
}

export interface SourcingResult {
  orderId: string;
  status: OrderStatus;
  fullyAllocated: boolean;
  shipments: {
    shipmentId: string;
    locationId: string;
    fulfillmentType: FulfillmentType;
    lines: { skuId: string; quantity: number }[];
  }[];
  backordered: { skuId: string; quantity: number }[];
}

/**
 * Distributed Order Management sourcing engine. Given a VALIDATED order, decides
 * which node(s) fulfil each line under a configurable strategy, hard-commits the
 * inventory, and groups the result into one shipment per node (split-shipment).
 *
 * The whole decision + commit runs in a single transaction so allocations are
 * atomic and oversell-safe even under concurrent sourcing of the same SKUs.
 */
@Injectable()
export class SourcingService {
  private readonly log = new Logger(SourcingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
  ) {}

  async sourceOrder(tenantId: string, orderId: string): Promise<SourcingResult> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { lines: true },
    });
    if (!order) throw new BadRequestException(`Order ${orderId} not found`);
    if (order.status !== OrderStatus.VALIDATED) {
      throw new BadRequestException(
        `Order must be VALIDATED to source (is ${order.status})`,
      );
    }

    const strategy = await this.resolveStrategy(order);

    const result = await retryOnConflict(
      () => this.prisma.$transaction(async (tx) => {
      // Free this order's own soft holds back to availability so the planner
      // works against a clean picture; we re-commit as hard allocations below.
      await this.releaseOwnReservations(tx, order);

      const byLocation = new Map<string, PlanLeg[]>();
      const backordered: { skuId: string; quantity: number }[] = [];

      for (const line of order.lines) {
        const candidates = await this.candidatesForLine(
          tx,
          order,
          line.skuId,
        );
        const plan = this.planLine(strategy, line.quantity, candidates);
        const planned = plan.reduce((s, l) => s + l.quantity, 0);

        if (planned < line.quantity) {
          if (!order.allowBackorder) {
            throw new BadRequestException(
              `Cannot source ${line.quantity} of sku ${line.skuId}: only ${planned} available (no backorder)`,
            );
          }
          backordered.push({
            skuId: line.skuId,
            quantity: line.quantity - planned,
          });
        }

        for (const leg of plan) {
          await this.inventory.apply(
            {
              tenantId,
              skuId: line.skuId,
              locationId: leg.locationId,
              eventType: 'ALLOCATE',
              deltas: { allocated: leg.quantity },
              requireAvailable: true,
              referenceType: 'order',
              referenceId: order.id,
            },
            tx,
          );
          const legs = byLocation.get(leg.locationId) ?? [];
          legs.push({ locationId: leg.locationId, quantity: leg.quantity });
          byLocation.set(leg.locationId, legs);
        }

        // Persist allocations per leg, tagged to this line.
        for (const leg of plan) {
          await tx.allocation.create({
            data: {
              tenantId,
              orderId: order.id,
              orderLineId: line.id,
              skuId: line.skuId,
              locationId: leg.locationId,
              quantity: leg.quantity,
              status: AllocationStatus.ALLOCATED,
            },
          });
        }
      }

      // One shipment per node; attach that node's allocations to it (split-shipment).
      const shipmentsOut: SourcingResult['shipments'] = [];
      for (const locationId of byLocation.keys()) {
        const location = await tx.location.findUniqueOrThrow({
          where: { id: locationId },
        });
        const shipment = await tx.shipment.create({
          data: {
            tenantId,
            orderId: order.id,
            locationId,
            fulfillmentType: this.fulfillmentTypeFor(location.type),
          },
        });
        const allocs = await tx.allocation.updateMany({
          where: { orderId: order.id, locationId, shipmentId: null },
          data: { shipmentId: shipment.id },
        });
        const lines = await tx.allocation.findMany({
          where: { shipmentId: shipment.id },
          select: { skuId: true, quantity: true },
        });
        void allocs;
        shipmentsOut.push({
          shipmentId: shipment.id,
          locationId,
          fulfillmentType: shipment.fulfillmentType,
          lines: lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.ALLOCATED },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: OrderStatus.VALIDATED,
          toStatus: OrderStatus.ALLOCATED,
          note: `sourced via ${strategy}${
            backordered.length ? ' (partial — backorder)' : ''
          }`,
        },
      });

      return { shipmentsOut, backordered };
      }),
      { label: `source:${orderId}` },
    );

    // Refresh ATP cache for every SKU touched.
    await Promise.all(
      [...new Set(order.lines.map((l) => l.skuId))].map((skuId) =>
        this.inventory.invalidate(tenantId, skuId),
      ),
    );

    this.log.log(
      `Sourced order ${order.id} via ${strategy}: ${result.shipmentsOut.length} shipment(s)`,
    );

    return {
      orderId: order.id,
      status: OrderStatus.ALLOCATED,
      fullyAllocated: result.backordered.length === 0,
      shipments: result.shipmentsOut,
      backordered: result.backordered,
    };
  }

  // ── Strategy resolution & planning ─────────────────────────────────────────

  private async resolveStrategy(order: Order): Promise<SourcingStrategy> {
    const rule = await this.prisma.sourcingRule.findFirst({
      where: {
        tenantId: order.tenantId,
        active: true,
        OR: [{ channel: order.channel }, { channel: null }],
        AND: [{ OR: [{ region: order.shipToRegion }, { region: null }] }],
      },
      orderBy: { priority: 'asc' },
    });
    return rule?.strategy ?? SourcingStrategy.BALANCED;
  }

  private async candidatesForLine(
    tx: Prisma.TransactionClient,
    order: Order,
    skuId: string,
  ): Promise<Candidate[]> {
    const snaps = await tx.inventorySnapshot.findMany({
      where: {
        tenantId: order.tenantId,
        skuId,
        location: { active: true, shipFromEnabled: true },
      },
      include: {
        location: {
          select: {
            type: true,
            fulfillmentPriority: true,
            latitude: true,
            longitude: true,
            dailyOrderCapacity: true,
          },
        },
      },
    });

    const candidates: Candidate[] = [];
    for (const s of snaps) {
      const available = s.onHand - s.reserved - s.allocated - s.safetyStock;
      if (available <= 0) continue;

      // Soft capacity guard: skip nodes already at their open-allocation cap.
      if (s.location.dailyOrderCapacity != null) {
        const open = await tx.allocation.count({
          where: {
            locationId: s.locationId,
            status: {
              in: [AllocationStatus.ALLOCATED, AllocationStatus.PICKED],
            },
          },
        });
        if (open >= s.location.dailyOrderCapacity) continue;
      }

      const distanceKm =
        order.shipToLatitude != null &&
        order.shipToLongitude != null &&
        s.location.latitude != null &&
        s.location.longitude != null
          ? haversineKm(
              order.shipToLatitude,
              order.shipToLongitude,
              s.location.latitude,
              s.location.longitude,
            )
          : null;

      candidates.push({
        locationId: s.locationId,
        type: s.location.type,
        available,
        priority: s.location.fulfillmentPriority,
        distanceKm,
      });
    }
    return candidates;
  }

  private planLine(
    strategy: SourcingStrategy,
    quantity: number,
    candidates: Candidate[],
  ): PlanLeg[] {
    if (!candidates.length) return [];

    // FEWEST_SPLITS: if a single node can cover the whole line, use it.
    if (strategy === SourcingStrategy.FEWEST_SPLITS) {
      const single = candidates
        .filter((c) => c.available >= quantity)
        .sort((a, b) => a.priority - b.priority || b.available - a.available)[0];
      if (single) return [{ locationId: single.locationId, quantity }];
    }

    const ordered = [...candidates].sort(this.comparator(strategy));

    const plan: PlanLeg[] = [];
    let remaining = quantity;
    for (const c of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, c.available);
      plan.push({ locationId: c.locationId, quantity: take });
      remaining -= take;
    }
    return plan;
  }

  private comparator(
    strategy: SourcingStrategy,
  ): (a: Candidate, b: Candidate) => number {
    switch (strategy) {
      case SourcingStrategy.NEAREST:
        return (a, b) =>
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
          a.priority - b.priority ||
          b.available - a.available;
      case SourcingStrategy.PRIORITY:
        return (a, b) => a.priority - b.priority || b.available - a.available;
      case SourcingStrategy.FEWEST_SPLITS:
        // Greedy fallback: biggest pools first to minimise leg count.
        return (a, b) => b.available - a.available || a.priority - b.priority;
      case SourcingStrategy.BALANCED:
      default:
        return (a, b) =>
          a.priority - b.priority ||
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
          b.available - a.available;
    }
  }

  private async releaseOwnReservations(
    tx: Prisma.TransactionClient,
    order: Order,
  ): Promise<void> {
    const active = await tx.reservation.findMany({
      where: { orderId: order.id, status: ReservationStatus.ACTIVE },
    });
    for (const r of active) {
      await this.inventory.apply(
        {
          tenantId: order.tenantId,
          skuId: r.skuId,
          locationId: r.locationId,
          eventType: 'RELEASE_RESERVE',
          deltas: { reserved: -r.quantity },
          referenceType: 'reservation',
          referenceId: r.id,
        },
        tx,
      );
      await tx.reservation.update({
        where: { id: r.id },
        data: { status: ReservationStatus.CONSUMED },
      });
    }
  }

  private fulfillmentTypeFor(type: LocationType): FulfillmentType {
    switch (type) {
      case LocationType.STORE:
        return FulfillmentType.SHIP_FROM_STORE;
      case LocationType.DROP_SHIP_VENDOR:
        return FulfillmentType.DROP_SHIP;
      default:
        return FulfillmentType.SHIP_FROM_DC;
    }
  }
}
