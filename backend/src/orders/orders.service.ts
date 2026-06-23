import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AllocationStatus,
  Order,
  OrderStatus,
  Prisma,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { EventsService } from '../events/events.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateOrderDto, OrderListQueryDto } from './dto/order.dto';
import { assertTransition } from './order-state-machine';
import { ReservationService } from './reservations.service';
import { OrderValidationService } from './validation.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly reservations: ReservationService,
    private readonly validation: OrderValidationService,
    private readonly events: EventsService,
  ) {}

  /** Capture a canonical order from any channel. */
  async create(tenantId: string, dto: CreateOrderDto): Promise<Order> {
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId,
          channel: dto.channel,
          externalRef: dto.externalRef,
          customerRef: dto.customerRef,
          currency: dto.currency ?? 'USD',
          shipToLatitude: dto.shipToLatitude,
          shipToLongitude: dto.shipToLongitude,
          shipToRegion: dto.shipToRegion,
          allowSplit: dto.allowSplit ?? true,
          allowBackorder: dto.allowBackorder ?? false,
          status: OrderStatus.CREATED,
          lines: {
            create: dto.lines.map((l) => ({
              skuId: l.skuId,
              quantity: l.quantity,
              unitPrice: l.unitPrice ?? 0,
            })),
          },
        },
      });
      await tx.orderEvent.create({
        data: { orderId: created.id, toStatus: OrderStatus.CREATED },
      });
      return created;
    });

    if (dto.reserveOnCreate) {
      await this.reservations.reserveForOrder(order.id);
    }

    return this.get(tenantId, order.id);
  }

  /** Paginated, filterable order list for the operations console. */
  async list(tenantId: string, q: OrderListQueryDto) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.search
        ? {
            OR: [
              { externalRef: { contains: q.search, mode: 'insensitive' } },
              { customerRef: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { lines: true, _count: { select: { shipments: true } } },
      }),
      this.prisma.order.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        lines: true,
        reservations: true,
        allocations: true,
        shipments: { include: { allocations: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  /** Run the validation pipeline (payment/fraud/tax/promo) then move to VALIDATED. */
  async validate(tenantId: string, id: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    const outcome = this.validation.evaluate(order);
    await this.prisma.order.update({
      where: { id },
      data: {
        paymentStatus: outcome.paymentStatus,
        fraudStatus: outcome.fraudStatus,
        taxTotal: outcome.taxTotal,
        discountTotal: outcome.discountTotal,
      },
    });

    if (outcome.rejection) {
      // Block validation and cancel the order (releasing any holds).
      await this.cancel(tenantId, id, `validation failed: ${outcome.rejection}`);
      throw new BadRequestException(
        `Order validation failed: ${outcome.rejection}`,
      );
    }

    return this.transition(tenantId, id, OrderStatus.VALIDATED, 'validated');
  }

  /** Generic guarded transition with an audit event. */
  async transition(
    tenantId: string,
    id: string,
    to: OrderStatus,
    note?: string,
  ): Promise<Order> {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, tenantId } });
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      assertTransition(order.status, to);
      const updated = await tx.order.update({
        where: { id },
        data: { status: to },
      });
      await tx.orderEvent.create({
        data: { orderId: id, fromStatus: order.status, toStatus: to, note },
      });
      return updated;
    });
    // Emit after the transaction commits so SSE subscribers see durable state.
    this.events.publish({
      tenantId,
      type: 'order.status',
      subjectId: id,
      data: { status: to },
    });
    return result;
  }

  /**
   * Cancel an order: release any active reservations and hard allocations back
   * to ATP, cancel open shipments, then move to CANCELLED.
   */
  async cancel(tenantId: string, id: string, note?: string): Promise<Order> {
    const order = await this.requireOrder(tenantId, id);

    await this.reservations.releaseForOrder(order.id);

    const allocations = await this.prisma.allocation.findMany({
      where: {
        orderId: order.id,
        status: { in: [AllocationStatus.ALLOCATED, AllocationStatus.PICKED] },
      },
    });
    for (const a of allocations) {
      await this.prisma.$transaction(async (tx) => {
        await this.inventory.apply(
          {
            tenantId,
            skuId: a.skuId,
            locationId: a.locationId,
            eventType: 'DEALLOCATE',
            deltas: { allocated: -a.quantity },
            referenceType: 'allocation',
            referenceId: a.id,
          },
          tx,
        );
        await tx.allocation.update({
          where: { id: a.id },
          data: { status: AllocationStatus.CANCELLED },
        });
      });
      await this.inventory.invalidate(tenantId, a.skuId);
    }

    await this.prisma.shipment.updateMany({
      where: {
        orderId: order.id,
        status: { in: [ShipmentStatus.PENDING, ShipmentStatus.PICKED] },
      },
      data: { status: ShipmentStatus.CANCELLED },
    });

    return this.transition(tenantId, id, OrderStatus.CANCELLED, note);
  }

  private async requireOrder(tenantId: string, id: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
}
