import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Reservation, ReservationStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  ExpireOneJobData,
  QUEUES,
  RESERVATION_JOBS,
} from '../common/queues/queue.constants';
import { InventoryService } from '../inventory/inventory.service';
import { retryOnConflict } from '../common/retry.util';

interface PlanLeg {
  locationId: string;
  quantity: number;
}

/**
 * Soft holds with a TTL. A reservation reduces ATP without hard-committing to a
 * node, so the storefront can guarantee stock through checkout. Holds expire
 * automatically (delayed BullMQ job + scheduler sweep) so abandoned carts free
 * inventory back to ATP.
 */
@Injectable()
export class ReservationService {
  private readonly log = new Logger(ReservationService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    config: ConfigService,
    @InjectQueue(QUEUES.RESERVATION) private readonly queue: Queue,
  ) {
    this.ttlSeconds = config.get<number>('RESERVATION_TTL_SECONDS', 900);
  }

  /**
   * Reserve every line of an order. Each line is filled greedily across the
   * best-stocked nodes (a soft pre-source). Runs in one transaction so a line
   * that can't be fully covered rolls the whole order's holds back.
   */
  async reserveForOrder(orderId: string): Promise<Reservation[]> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: true },
    });

    const created = await retryOnConflict(
      () => this.prisma.$transaction(async (tx) => {
      const reservations: Reservation[] = [];
      for (const line of order.lines) {
        const plan = await this.planLine(
          tx,
          order.tenantId,
          line.skuId,
          line.quantity,
        );
        const planned = plan.reduce((s, l) => s + l.quantity, 0);
        if (planned < line.quantity && !order.allowBackorder) {
          throw new BadRequestException(
            `Cannot reserve ${line.quantity} of sku ${line.skuId}: only ${planned} available across the network`,
          );
        }

        const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
        for (const leg of plan) {
          await this.inventory.apply(
            {
              tenantId: order.tenantId,
              skuId: line.skuId,
              locationId: leg.locationId,
              eventType: 'RESERVE',
              deltas: { reserved: leg.quantity },
              requireAvailable: true,
              referenceType: 'order',
              referenceId: order.id,
            },
            tx,
          );
          const reservation = await tx.reservation.create({
            data: {
              tenantId: order.tenantId,
              skuId: line.skuId,
              locationId: leg.locationId,
              orderId: order.id,
              orderLineId: line.id,
              quantity: leg.quantity,
              expiresAt,
              status: ReservationStatus.ACTIVE,
            },
          });
          reservations.push(reservation);
        }
      }
      return reservations;
      }),
      { label: `reserve:${orderId}` },
    );

    // Invalidate ATP cache and schedule TTL expiry after commit.
    const skuIds = new Set(created.map((r) => r.skuId));
    await Promise.all(
      [...skuIds].map((skuId) => this.inventory.invalidate(order.tenantId, skuId)),
    );
    await Promise.all(created.map((r) => this.scheduleExpiry(r)));

    return created;
  }

  /** Greedily allocate `quantity` across active, ship-from nodes by availability. */
  private async planLine(
    tx: Prisma.TransactionClient,
    tenantId: string,
    skuId: string,
    quantity: number,
  ): Promise<PlanLeg[]> {
    const snaps = await tx.inventorySnapshot.findMany({
      where: {
        tenantId,
        skuId,
        location: { active: true, shipFromEnabled: true },
      },
      include: { location: { select: { fulfillmentPriority: true } } },
    });

    const candidates = snaps
      .map((s) => ({
        locationId: s.locationId,
        available: s.onHand - s.reserved - s.allocated - s.safetyStock,
        priority: s.location.fulfillmentPriority,
      }))
      .filter((c) => c.available > 0)
      .sort((a, b) => a.priority - b.priority || b.available - a.available);

    const plan: PlanLeg[] = [];
    let remaining = quantity;
    for (const c of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, c.available);
      plan.push({ locationId: c.locationId, quantity: take });
      remaining -= take;
    }
    return plan;
  }

  /** Release one reservation (idempotent). Returns true if it was active. */
  async release(
    reservationId: string,
    status: ReservationStatus = ReservationStatus.RELEASED,
  ): Promise<boolean> {
    const released = await this.prisma.$transaction(async (tx) => {
      const r = await tx.reservation.findUnique({
        where: { id: reservationId },
      });
      if (!r || r.status !== ReservationStatus.ACTIVE) return null;

      await this.inventory.apply(
        {
          tenantId: r.tenantId,
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
        data: { status },
      });
      return r;
    });

    if (released) {
      await this.inventory.invalidate(released.tenantId, released.skuId);
      return true;
    }
    return false;
  }

  /** Release every active reservation for an order (cancel path). */
  async releaseForOrder(orderId: string): Promise<void> {
    const active = await this.prisma.reservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE },
      select: { id: true },
    });
    for (const r of active) await this.release(r.id);
  }

  /** Safety-net sweep: release any active reservation already past expiry. */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.reservation.findMany({
      where: { status: ReservationStatus.ACTIVE, expiresAt: { lte: now } },
      select: { id: true },
    });
    let count = 0;
    for (const r of due) {
      if (await this.release(r.id, ReservationStatus.EXPIRED)) count++;
    }
    if (count) this.log.log(`Swept ${count} expired reservation(s)`);
    return count;
  }

  private async scheduleExpiry(r: Reservation): Promise<void> {
    const delay = Math.max(0, r.expiresAt.getTime() - Date.now());
    const data: ExpireOneJobData = { reservationId: r.id, tenantId: r.tenantId };
    await this.queue.add(RESERVATION_JOBS.EXPIRE_ONE, data, {
      delay,
      jobId: `expire-${r.id}`, // BullMQ custom job ids may not contain ':'
    });
  }
}
