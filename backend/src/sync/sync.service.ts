import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ChannelType,
  LocationType,
  OutboxStatus,
  Prisma,
  SalesChannel,
} from '@prisma/client';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, toSkipTake } from '../common/pagination';
import { AtpService } from '../inventory/atp.service';
import { InventoryService } from '../inventory/inventory.service';
import { ConnectorRegistry } from './connector.registry';
import { InventoryPush } from './connectors/channel-connector';
import { ShopifyAdminClient, ShopifyCreds } from './connectors/shopify-admin.client';
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
    private readonly inventory: InventoryService,
    private readonly connectors: ConnectorRegistry,
    private readonly crypto: CryptoService,
    private readonly shopify: ShopifyAdminClient,
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

  /**
   * Pull Shopify variants with SKU codes into the OMS catalog and mirror their
   * current available inventory into OMS snapshots.
   */
  async importShopify(
    tenantId: string,
    channelId: string,
  ): Promise<{
    skusImported: number;
    locationsImported: number;
    inventoryLevelsImported: number;
    skippedVariants: number;
  }> {
    const channel = await this.prisma.salesChannel.findFirst({
      where: { id: channelId, tenantId, type: ChannelType.SHOPIFY, active: true },
    });
    if (!channel) throw new NotFoundException('Active Shopify channel not found');

    const cfg = (channel.config ?? {}) as {
      shopDomain?: string;
      accessToken?: string;
      apiVersion?: string;
      inventoryLocationGid?: string;
    };
    if (!cfg.shopDomain || !cfg.accessToken) {
      throw new BadRequestException('Shopify channel is missing OAuth credentials');
    }

    const creds: ShopifyCreds = {
      shopDomain: cfg.shopDomain,
      accessToken: this.crypto.decrypt(cfg.accessToken),
      apiVersion: cfg.apiVersion ?? '2026-04',
    };
    const variants = await this.shopify.listInventoryVariants(creds);

    let skusImported = 0;
    let inventoryLevelsImported = 0;
    let skippedVariants = 0;
    let defaultLocationGid = cfg.inventoryLocationGid;
    const importedLocationIds = new Set<string>();

    for (const variant of variants) {
      if (!variant.levels.length) {
        skippedVariants += 1;
        continue;
      }

      const sku = await this.prisma.sku.upsert({
        where: { tenantId_code: { tenantId, code: variant.sku } },
        create: {
          tenantId,
          code: variant.sku,
          name:
            variant.title && variant.title !== 'Default Title'
              ? `${variant.productTitle} - ${variant.title}`
              : variant.productTitle,
        },
        update: {
          active: true,
          name:
            variant.title && variant.title !== 'Default Title'
              ? `${variant.productTitle} - ${variant.title}`
              : variant.productTitle,
        },
      });
      skusImported += 1;

      await this.prisma.channelSkuMapping.upsert({
        where: { channelId_skuId: { channelId: channel.id, skuId: sku.id } },
        create: {
          channelId: channel.id,
          skuId: sku.id,
          inventoryItemId: variant.inventoryItemId,
          variantId: variant.variantId,
        },
        update: {
          inventoryItemId: variant.inventoryItemId,
          variantId: variant.variantId,
        },
      });

      for (const level of variant.levels) {
        if (!defaultLocationGid) defaultLocationGid = level.locationId;
        const location = await this.prisma.location.upsert({
          where: {
            tenantId_code: {
              tenantId,
              code: this.locationCode(level.locationId),
            },
          },
          create: {
            tenantId,
            code: this.locationCode(level.locationId),
            name: level.locationName,
            type: LocationType.WAREHOUSE,
          },
          update: { active: true, name: level.locationName },
        });
        importedLocationIds.add(location.id);

        const current = await this.prisma.inventorySnapshot.findUnique({
          where: {
            tenantId_skuId_locationId: {
              tenantId,
              skuId: sku.id,
              locationId: location.id,
            },
          },
          select: { onHand: true },
        });
        const delta = level.available - (current?.onHand ?? 0);
        if (delta !== 0) {
          await this.inventory.adjust({
            tenantId,
            skuId: sku.id,
            locationId: location.id,
            delta,
            reason: `Shopify import ${channel.name}`,
          });
        }
        inventoryLevelsImported += 1;
      }
    }

    if (defaultLocationGid && defaultLocationGid !== cfg.inventoryLocationGid) {
      await this.prisma.salesChannel.update({
        where: { id: channel.id },
        data: {
          config: {
            ...cfg,
            inventoryLocationGid: defaultLocationGid,
          } as Prisma.InputJsonValue,
        },
      });
    }

    this.log.log(
      `Imported Shopify channel ${channel.id}: ${skusImported} SKU(s), ` +
        `${inventoryLevelsImported} inventory level(s)`,
    );
    return {
      skusImported,
      locationsImported: importedLocationIds.size,
      inventoryLevelsImported,
      skippedVariants,
    };
  }

  private locationCode(locationGid: string): string {
    return `SHOPIFY-${locationGid.split('/').pop() ?? locationGid}`;
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
