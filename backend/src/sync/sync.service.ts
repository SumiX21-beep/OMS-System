import { Injectable, Logger } from '@nestjs/common';
import { OutboxStatus, Prisma, SalesChannel } from '@prisma/client';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { AtpService } from '../inventory/atp.service';
import { ConnectorRegistry } from './connector.registry';
import { InventoryPush } from './connectors/channel-connector';
import {
  ChangesQueryDto,
  CreateChannelDto,
  OutboxListQueryDto,
} from './dto/sync.dto';

/**
 * Phase 5 — keeps sales channels in sync with the OMS (the source of truth) and
 * exposes read feeds for the downstream drift-guard (StockShield):
 *   • drainOutbox(): push changed ATP to each active channel,
 *   • inventoryFeed(): the canonical full ATP snapshot,
 *   • changesSince(): a seq-cursored delta feed.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly atp: AtpService,
    private readonly connectors: ConnectorRegistry,
    private readonly crypto: CryptoService,
  ) {}

  // ── Channel admin ──────────────────────────────────────────────────────────

  createChannel(tenantId: string, dto: CreateChannelDto) {
    return this.prisma.salesChannel.create({
      data: {
        tenantId,
        type: dto.type,
        name: dto.name,
        config: this.sealConfig(dto.config),
      },
    });
  }

  /** Encrypt known sensitive keys (access token, webhook secret) at rest. */
  private sealConfig(
    config?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!config) return undefined;
    const sealed = { ...config };
    for (const key of ['accessToken', 'webhookSecret'] as const) {
      const v = sealed[key];
      if (typeof v === 'string' && v !== '') sealed[key] = this.crypto.encrypt(v);
    }
    return sealed as Prisma.InputJsonValue;
  }

  listChannels(tenantId: string) {
    return this.prisma.salesChannel.findMany({ where: { tenantId } });
  }

  /** Paginated outbox monitoring view (newest first). seq is serialised to a string. */
  async listOutbox(tenantId: string, q: OutboxListQueryDto) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.OutboxEventWhereInput = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.outboxEvent.findMany({
        where,
        skip,
        take,
        orderBy: { seq: 'desc' },
      }),
      this.prisma.outboxEvent.count({ where }),
    ]);
    const items = rows.map((r) => ({ ...r, seq: r.seq.toString() }));
    return makePage(items, total, page, pageSize);
  }

  // ── Outbox drain (push) ──────────────────────────────────────────────────--

  /**
   * Publish pending INVENTORY_ATP_CHANGED events to every active channel.
   * Coalesces many events for the same SKU into one push of its current ATP.
   * Returns the number of outbox rows marked published.
   */
  async drainOutbox(batch = 500): Promise<number> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: OutboxStatus.PENDING },
      orderBy: { seq: 'asc' },
      take: batch,
    });
    if (!pending.length) return 0;

    // Group by tenant, then collapse to the latest-known SKU set.
    const byTenant = new Map<string, typeof pending>();
    for (const e of pending) {
      const arr = byTenant.get(e.tenantId) ?? [];
      arr.push(e);
      byTenant.set(e.tenantId, arr);
    }

    for (const [tenantId, events] of byTenant) {
      const channels = await this.prisma.salesChannel.findMany({
        where: { tenantId, active: true },
      });

      const skuIds = [
        ...new Set(
          events
            .filter((e) => e.type === 'INVENTORY_ATP_CHANGED')
            .map((e) => e.subjectId),
        ),
      ];

      if (channels.length && skuIds.length) {
        const items = await this.atpFor(tenantId, skuIds);
        for (const channel of channels) {
          await this.publishToChannel(channel, items);
        }
      }

      await this.prisma.outboxEvent.updateMany({
        where: { id: { in: events.map((e) => e.id) } },
        data: {
          status: OutboxStatus.PUBLISHED,
          publishedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    }

    this.log.log(`Drained ${pending.length} outbox event(s)`);
    return pending.length;
  }

  private async publishToChannel(
    channel: SalesChannel,
    items: InventoryPush[],
  ): Promise<void> {
    try {
      await this.connectors.get(channel.type).pushInventory(channel, items);
    } catch (err) {
      this.log.error(
        `Publish to channel ${channel.id} failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private async atpFor(
    tenantId: string,
    skuIds: string[],
  ): Promise<InventoryPush[]> {
    if (!skuIds.length) return [];
    const skus = await this.prisma.sku.findMany({
      where: { tenantId, id: { in: skuIds } },
      select: { id: true, code: true },
    });
    const codeById = new Map(skus.map((s) => [s.id, s.code]));

    const out: InventoryPush[] = [];
    for (const skuId of skuIds) {
      const view = await this.atp.network(tenantId, skuId);
      out.push({
        skuId,
        skuCode: codeById.get(skuId) ?? skuId,
        availableToPromise: view.availableToPromise,
      });
    }
    return out;
  }

  // ── Read feeds (pull — StockShield reads OMS as source of truth) ───────────--

  /** Canonical full ATP snapshot for every active SKU of a tenant. */
  async inventoryFeed(tenantId: string): Promise<InventoryPush[]> {
    const skus = await this.prisma.sku.findMany({
      where: { tenantId, active: true },
      select: { id: true },
    });
    return this.atpFor(
      tenantId,
      skus.map((s) => s.id),
    );
  }

  /**
   * Delta feed: ATP for SKUs that changed after `since`, plus the new cursor.
   * StockShield polls this and only re-checks the SKUs that moved.
   */
  async changesSince(
    tenantId: string,
    q: ChangesQueryDto,
  ): Promise<{ cursor: number; items: InventoryPush[] }> {
    const since = BigInt(q.since ?? 0);
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        tenantId,
        type: 'INVENTORY_ATP_CHANGED',
        seq: { gt: since },
      },
      orderBy: { seq: 'asc' },
      take: q.limit ?? 200,
    });

    const cursor = events.length
      ? Number(events[events.length - 1].seq)
      : Number(since);
    const skuIds = [...new Set(events.map((e) => e.subjectId))];
    const items = await this.atpFor(tenantId, skuIds);
    return { cursor, items };
  }
}
