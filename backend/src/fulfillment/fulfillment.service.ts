import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AllocationStatus,
  OrderStatus,
  Prisma,
  Shipment,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { WmsService } from './wms.service';

// Linear post-allocation chain the order walks as its shipments progress.
const ORDER_CHAIN: OrderStatus[] = [
  OrderStatus.ALLOCATED,
  OrderStatus.RELEASED,
  OrderStatus.PICKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const SHIPMENT_RANK: Record<ShipmentStatus, number> = {
  [ShipmentStatus.PENDING]: 0,
  [ShipmentStatus.PICKED]: 1,
  // "ready for pickup" and "shipped" both mean the goods have left our hands.
  [ShipmentStatus.READY_FOR_PICKUP]: 2,
  [ShipmentStatus.SHIPPED]: 2,
  // "picked up" and "delivered" are both the terminal customer-has-it state.
  [ShipmentStatus.PICKED_UP]: 3,
  [ShipmentStatus.DELIVERED]: 3,
  [ShipmentStatus.CANCELLED]: -1,
};

/**
 * Drives shipments through pick → ship → deliver, performs the real inventory
 * ship-out (on-hand and allocated both decrement), and rolls the parent order's
 * status forward once *all* its shipments reach a stage (split-shipment aware).
 */
@Injectable()
export class FulfillmentService {
  private readonly log = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly wms: WmsService,
  ) {}

  /** Hand a picked shipment off to its WMS/3PL; records provider + job id. */
  async dispatch(tenantId: string, shipmentId: string): Promise<Shipment> {
    const shipment = await this.requireShipment(tenantId, shipmentId);
    if (
      shipment.status !== ShipmentStatus.PICKED &&
      shipment.status !== ShipmentStatus.PENDING
    ) {
      throw new BadRequestException(
        `Shipment must be PENDING/PICKED to dispatch (is ${shipment.status})`,
      );
    }
    const lines = await this.prisma.allocation.findMany({
      where: { shipmentId },
      select: { skuId: true, quantity: true },
    });
    const result = await this.wms.dispatch(shipment, lines);
    return this.prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        fulfillmentProvider: result.provider,
        externalJobId: result.jobId,
      },
    });
  }

  /** BOPIS/curbside: stage a picked shipment for customer collection. */
  async markReadyForPickup(
    tenantId: string,
    shipmentId: string,
  ): Promise<Shipment> {
    const shipment = await this.requireShipment(tenantId, shipmentId);
    if (shipment.status !== ShipmentStatus.PICKED) {
      throw new BadRequestException(
        `Shipment must be PICKED to mark ready (is ${shipment.status})`,
      );
    }
    const updated = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.READY_FOR_PICKUP },
    });
    await this.rollupOrder(tenantId, shipment.orderId);
    return updated;
  }

  /** BOPIS/curbside: customer collects — depletes stock, completes the order. */
  async pickUp(tenantId: string, shipmentId: string): Promise<Shipment> {
    const shipment = await this.requireShipment(tenantId, shipmentId);
    if (shipment.status !== ShipmentStatus.READY_FOR_PICKUP) {
      throw new BadRequestException(
        `Shipment must be READY_FOR_PICKUP to pick up (is ${shipment.status})`,
      );
    }
    const allocations = await this.prisma.allocation.findMany({
      where: { shipmentId, status: AllocationStatus.PICKED },
    });
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const a of allocations) {
        await this.inventory.apply(
          {
            tenantId,
            skuId: a.skuId,
            locationId: a.locationId,
            eventType: 'SHIP',
            deltas: { onHand: -a.quantity, allocated: -a.quantity },
            referenceType: 'shipment',
            referenceId: shipmentId,
          },
          tx,
        );
      }
      await tx.allocation.updateMany({
        where: { shipmentId, status: AllocationStatus.PICKED },
        data: { status: AllocationStatus.SHIPPED },
      });
      return tx.shipment.update({
        where: { id: shipmentId },
        data: { status: ShipmentStatus.PICKED_UP },
      });
    });
    await Promise.all(
      [...new Set(allocations.map((a) => a.skuId))].map((skuId) =>
        this.inventory.invalidate(tenantId, skuId),
      ),
    );
    await this.rollupOrder(tenantId, shipment.orderId);
    return updated;
  }

  /** Paginated shipment list for the fulfilment board. */
  async listShipments(
    tenantId: string,
    q: {
      status?: ShipmentStatus;
      orderId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.ShipmentWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          allocations: { select: { skuId: true, quantity: true } },
          location: { select: { code: true, name: true } },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  async pick(tenantId: string, shipmentId: string): Promise<Shipment> {
    const shipment = await this.requireShipment(tenantId, shipmentId);
    if (shipment.status !== ShipmentStatus.PENDING) {
      throw new BadRequestException(
        `Shipment must be PENDING to pick (is ${shipment.status})`,
      );
    }
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: shipment.orderId },
    });
    if (
      order.status !== OrderStatus.RELEASED &&
      order.status !== OrderStatus.PICKED
    ) {
      throw new BadRequestException(
        `Order must be RELEASED before picking (is ${order.status})`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.allocation.updateMany({
        where: { shipmentId, status: AllocationStatus.ALLOCATED },
        data: { status: AllocationStatus.PICKED },
      });
      return tx.shipment.update({
        where: { id: shipmentId },
        data: { status: ShipmentStatus.PICKED },
      });
    });

    await this.rollupOrder(tenantId, shipment.orderId);
    return updated;
  }

  async ship(
    tenantId: string,
    shipmentId: string,
    carrier?: string,
  ): Promise<Shipment> {
    const shipment = await this.requireShipment(tenantId, shipmentId);
    if (shipment.status !== ShipmentStatus.PICKED) {
      throw new BadRequestException(
        `Shipment must be PICKED to ship (is ${shipment.status})`,
      );
    }

    const allocations = await this.prisma.allocation.findMany({
      where: { shipmentId, status: AllocationStatus.PICKED },
    });

    const trackingNumber = `TRK-${randomUUID().slice(0, 12).toUpperCase()}`;
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const a of allocations) {
        // Real depletion: on-hand and allocated both drop.
        await this.inventory.apply(
          {
            tenantId,
            skuId: a.skuId,
            locationId: a.locationId,
            eventType: 'SHIP',
            deltas: { onHand: -a.quantity, allocated: -a.quantity },
            referenceType: 'shipment',
            referenceId: shipmentId,
          },
          tx,
        );
      }
      await tx.allocation.updateMany({
        where: { shipmentId, status: AllocationStatus.PICKED },
        data: { status: AllocationStatus.SHIPPED },
      });
      return tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.SHIPPED,
          carrier: carrier ?? 'DEMO-CARRIER',
          trackingNumber,
        },
      });
    });

    await Promise.all(
      [...new Set(allocations.map((a) => a.skuId))].map((skuId) =>
        this.inventory.invalidate(tenantId, skuId),
      ),
    );
    await this.rollupOrder(tenantId, shipment.orderId);
    this.log.log(`Shipped ${shipmentId} (${trackingNumber})`);
    return updated;
  }

  async deliver(tenantId: string, shipmentId: string): Promise<Shipment> {
    const shipment = await this.requireShipment(tenantId, shipmentId);
    if (shipment.status !== ShipmentStatus.SHIPPED) {
      throw new BadRequestException(
        `Shipment must be SHIPPED to deliver (is ${shipment.status})`,
      );
    }
    const updated = await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.DELIVERED },
    });
    await this.rollupOrder(tenantId, shipment.orderId);
    return updated;
  }

  /**
   * Advance the order to the stage reached by the *least* progressed active
   * shipment, stepping through the linear chain so each transition stays legal.
   */
  private async rollupOrder(tenantId: string, orderId: string): Promise<void> {
    const shipments = await this.prisma.shipment.findMany({
      where: { orderId },
    });
    const active = shipments.filter(
      (s) => s.status !== ShipmentStatus.CANCELLED,
    );
    if (!active.length) return;

    const minRank = Math.min(...active.map((s) => SHIPMENT_RANK[s.status]));
    const target =
      minRank >= 3
        ? OrderStatus.DELIVERED
        : minRank >= 2
          ? OrderStatus.SHIPPED
          : minRank >= 1
            ? OrderStatus.PICKED
            : null;
    if (!target) return;

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    let fromIdx = ORDER_CHAIN.indexOf(order.status);
    const toIdx = ORDER_CHAIN.indexOf(target);
    if (fromIdx < 0 || toIdx <= fromIdx) return;

    for (let i = fromIdx + 1; i <= toIdx; i++) {
      await this.orders.transition(
        tenantId,
        orderId,
        ORDER_CHAIN[i],
        'fulfilment rollup',
      );
    }
  }

  private async requireShipment(
    tenantId: string,
    shipmentId: string,
  ): Promise<Shipment> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
    });
    if (!shipment) {
      throw new BadRequestException(`Shipment ${shipmentId} not found`);
    }
    return shipment;
  }
}
