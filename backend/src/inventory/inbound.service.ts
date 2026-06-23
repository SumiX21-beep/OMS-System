import { BadRequestException, Injectable } from '@nestjs/common';
import { Inbound, InboundStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { InventoryService } from './inventory.service';

/**
 * Tracks expected inbound supply with ETAs. Each inbound adds to the snapshot's
 * inTransit bucket (via the ledger) and is recorded with an `expectedAt` so the
 * ATP engine can count only stock arriving within its horizon.
 */
@Injectable()
export class InboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async create(p: {
    tenantId: string;
    skuId: string;
    locationId: string;
    quantity: number;
    expectedAt?: Date;
    reference?: string;
  }): Promise<Inbound> {
    const expectedAt = p.expectedAt ?? new Date();
    const inbound = await this.prisma.$transaction(async (tx) => {
      const row = await tx.inbound.create({
        data: {
          tenantId: p.tenantId,
          skuId: p.skuId,
          locationId: p.locationId,
          quantity: p.quantity,
          expectedAt,
          reference: p.reference,
          status: InboundStatus.EXPECTED,
        },
      });
      await this.inventory.apply(
        {
          tenantId: p.tenantId,
          skuId: p.skuId,
          locationId: p.locationId,
          eventType: 'INBOUND_CREATE',
          deltas: { inTransit: p.quantity },
          referenceType: 'inbound',
          referenceId: row.id,
        },
        tx,
      );
      return row;
    });
    await this.inventory.invalidate(p.tenantId, p.skuId);
    return inbound;
  }

  /** Paginated inbound list for the console. */
  async list(
    tenantId: string,
    q: {
      skuId?: string;
      locationId?: string;
      status?: InboundStatus;
      page?: number;
      pageSize?: number;
    },
  ) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.InboundWhereInput = {
      tenantId,
      ...(q.skuId ? { skuId: q.skuId } : {}),
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.inbound.findMany({
        where,
        skip,
        take,
        orderBy: { expectedAt: 'asc' },
        include: {
          sku: { select: { code: true } },
          location: { select: { code: true } },
        },
      }),
      this.prisma.inbound.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  /** Receive (all or part of) an inbound: inTransit → onHand. */
  async receive(
    tenantId: string,
    inboundId: string,
    quantity?: number,
  ): Promise<Inbound> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const inbound = await tx.inbound.findFirst({
        where: { id: inboundId, tenantId },
      });
      if (!inbound) throw new BadRequestException(`Inbound ${inboundId} not found`);
      if (inbound.status !== InboundStatus.EXPECTED) {
        throw new BadRequestException(
          `Inbound ${inboundId} is ${inbound.status}`,
        );
      }
      const remaining = inbound.quantity - inbound.receivedQty;
      const q = Math.min(quantity ?? remaining, remaining);
      if (q <= 0) throw new BadRequestException('Nothing left to receive');

      await this.inventory.apply(
        {
          tenantId,
          skuId: inbound.skuId,
          locationId: inbound.locationId,
          eventType: 'INBOUND_ARRIVE',
          deltas: { inTransit: -q, onHand: q },
          referenceType: 'inbound',
          referenceId: inbound.id,
        },
        tx,
      );
      const receivedQty = inbound.receivedQty + q;
      return tx.inbound.update({
        where: { id: inbound.id },
        data: {
          receivedQty,
          status:
            receivedQty >= inbound.quantity
              ? InboundStatus.RECEIVED
              : InboundStatus.EXPECTED,
        },
      });
    });
    await this.inventory.invalidate(tenantId, updated.skuId);
    return updated;
  }
}
