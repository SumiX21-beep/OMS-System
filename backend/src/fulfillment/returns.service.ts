import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  Return,
  ReturnStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateReturnDto, ReturnListQueryDto } from './dto/fulfillment.dto';

/**
 * Reverse logistics. An RMA is raised against a DELIVERED order; on receipt the
 * returned units flow back into on-hand (ATP) at the chosen node, and the order
 * is marked RETURNED once everything ordered has come back.
 */
@Injectable()
export class ReturnsService {
  private readonly log = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  /** Paginated RMA list for the console. */
  async list(tenantId: string, q: ReturnListQueryDto) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.ReturnWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.return.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { lines: true },
      }),
      this.prisma.return.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  async create(tenantId: string, dto: CreateReturnDto): Promise<Return> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId },
      include: { lines: true },
    });
    if (!order) throw new BadRequestException(`Order ${dto.orderId} not found`);
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        `Only DELIVERED orders can be returned (is ${order.status})`,
      );
    }

    // Validate every return line maps to an order line and is within quantity.
    for (const rl of dto.lines) {
      const ol = order.lines.find((l) => l.id === rl.orderLineId);
      if (!ol) {
        throw new BadRequestException(
          `Order line ${rl.orderLineId} not on order ${order.id}`,
        );
      }
      if (rl.quantity < 1 || rl.quantity > ol.quantity) {
        throw new BadRequestException(
          `Return qty ${rl.quantity} invalid for order line ${rl.orderLineId} (ordered ${ol.quantity})`,
        );
      }
    }

    return this.prisma.return.create({
      data: {
        tenantId,
        orderId: order.id,
        reason: dto.reason,
        rma: `RMA-${randomUUID().slice(0, 8).toUpperCase()}`,
        status: ReturnStatus.REQUESTED,
        lines: {
          create: dto.lines.map((rl) => {
            const ol = order.lines.find((l) => l.id === rl.orderLineId)!;
            return {
              orderLineId: rl.orderLineId,
              skuId: ol.skuId,
              quantity: rl.quantity,
              restock: rl.restock ?? true,
              locationId: rl.locationId,
            };
          }),
        },
      },
      include: { lines: true },
    });
  }

  /** Receive the goods: restock sellable units back to ATP, then complete. */
  async receive(tenantId: string, returnId: string): Promise<Return> {
    const rma = await this.prisma.return.findFirst({
      where: { id: returnId, tenantId },
      include: { lines: true },
    });
    if (!rma) throw new BadRequestException(`Return ${returnId} not found`);
    if (rma.status !== ReturnStatus.REQUESTED) {
      throw new BadRequestException(
        `Return must be REQUESTED to receive (is ${rma.status})`,
      );
    }

    // Default restock node: where the order's first shipment went, else any node.
    const fallbackLocation = await this.defaultRestockLocation(
      tenantId,
      rma.orderId,
    );

    await this.prisma.$transaction(async (tx) => {
      for (const line of rma.lines) {
        if (!line.restock) continue;
        const locationId = line.locationId ?? fallbackLocation;
        if (!locationId) {
          throw new BadRequestException(
            `No restock location for return line ${line.id}`,
          );
        }
        await this.inventory.apply(
          {
            tenantId,
            skuId: line.skuId,
            locationId,
            eventType: 'RETURN',
            deltas: { onHand: line.quantity },
            referenceType: 'return',
            referenceId: rma.id,
            reason: 'rma-restock',
          },
          tx,
        );
      }
      await tx.return.update({
        where: { id: rma.id },
        data: { status: ReturnStatus.COMPLETED },
      });
    });

    await Promise.all(
      [...new Set(rma.lines.map((l) => l.skuId))].map((skuId) =>
        this.inventory.invalidate(tenantId, skuId),
      ),
    );

    // If the whole order has now been returned, reflect it on the order.
    await this.maybeMarkOrderReturned(tenantId, rma.orderId);

    // Refund the returned value to the customer's original charge.
    await this.refundReturn(tenantId, rma);
    this.log.log(`Received return ${rma.rma}`);

    return this.prisma.return.findUniqueOrThrow({
      where: { id: rma.id },
      include: { lines: true },
    });
  }

  /**
   * Refund the value of the returned lines against the order's captured charge.
   * Partial returns issue a partial refund and leave the order CAPTURED; once the
   * whole order is back (status RETURNED) the payment is marked REFUNDED.
   */
  private async refundReturn(
    tenantId: string,
    rma: Prisma.ReturnGetPayload<{ include: { lines: true } }>,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: rma.orderId, tenantId },
      include: { lines: true },
    });
    if (
      !order ||
      !order.paymentReference ||
      order.paymentStatus !== PaymentStatus.CAPTURED
    ) {
      return;
    }

    const priceByLine = new Map(order.lines.map((l) => [l.id, l.unitPrice]));
    const refundMinor = rma.lines.reduce(
      (sum, l) => sum + (priceByLine.get(l.orderLineId) ?? 0) * l.quantity,
      0,
    );
    if (refundMinor <= 0) return;

    const res = await this.payments.refund(order, refundMinor);
    if (res.status !== 'REFUNDED') {
      this.log.error(`Refund FAILED for return ${rma.rma} (order ${order.id})`);
      return;
    }
    this.log.log(`Refunded ${refundMinor} ${order.currency} for return ${rma.rma}`);

    // Whole order returned → settle the payment as fully refunded.
    if (order.status === OrderStatus.RETURNED) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: PaymentStatus.REFUNDED },
      });
    }
  }

  private async defaultRestockLocation(
    tenantId: string,
    orderId: string,
  ): Promise<string | null> {
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    if (shipment) return shipment.locationId;
    const loc = await this.prisma.location.findFirst({
      where: { tenantId, active: true },
      orderBy: { fulfillmentPriority: 'asc' },
    });
    return loc?.id ?? null;
  }

  private async maybeMarkOrderReturned(
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const [order, returnedAgg, orderedAgg] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      this.prisma.returnLine.groupBy({
        by: ['skuId'],
        where: { return: { orderId, status: ReturnStatus.COMPLETED } },
        _sum: { quantity: true },
      }),
      this.prisma.orderLine.groupBy({
        by: ['skuId'],
        where: { orderId },
        _sum: { quantity: true },
      }),
    ]);

    if (order.status !== OrderStatus.DELIVERED) return;

    const returned = new Map(
      returnedAgg.map((r) => [r.skuId, r._sum.quantity ?? 0]),
    );
    const fullyReturned = orderedAgg.every(
      (o) => (returned.get(o.skuId) ?? 0) >= (o._sum.quantity ?? 0),
    );
    if (fullyReturned) {
      await this.orders.transition(
        tenantId,
        orderId,
        OrderStatus.RETURNED,
        'all lines returned',
      );
    }
  }
}
