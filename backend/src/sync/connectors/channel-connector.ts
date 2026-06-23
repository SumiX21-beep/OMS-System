import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, SalesChannel } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ShopifyAdminClient, ShopifyCreds } from './shopify-admin.client';

export interface InventoryPush {
  skuId: string;
  skuCode: string;
  availableToPromise: number;
}

/** A sales-channel adapter. Real impls call the channel's inventory API. */
export interface ChannelConnector {
  readonly type: ChannelType;
  pushInventory(channel: SalesChannel, items: InventoryPush[]): Promise<void>;
}

interface ShopifyConfig {
  shopDomain?: string;
  accessToken?: string;
  apiVersion?: string;
  inventoryLocationGid?: string;
}

/**
 * Live Shopify connector. Pushes OMS Available-to-Promise to a Shopify location
 * via inventorySetQuantities, resolving (and caching) the SKU→InventoryItem
 * mapping. Falls back to a dry-run log when the channel has no token configured,
 * so local/dev environments work without real credentials.
 */
@Injectable()
export class ShopifyConnector implements ChannelConnector {
  readonly type = ChannelType.SHOPIFY;
  private readonly log = new Logger('ShopifyConnector');

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ShopifyAdminClient,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  async pushInventory(
    channel: SalesChannel,
    items: InventoryPush[],
  ): Promise<void> {
    const cfg = (channel.config ?? {}) as ShopifyConfig;
    const creds: ShopifyCreds | null =
      cfg.shopDomain && cfg.accessToken
        ? {
            shopDomain: cfg.shopDomain,
            accessToken: this.crypto.decrypt(cfg.accessToken),
            apiVersion:
              cfg.apiVersion ??
              this.config.get<string>('SHOPIFY_API_VERSION', '2026-04'),
          }
        : null;

    if (!creds || !cfg.inventoryLocationGid) {
      this.log.log(
        `[dry-run] ${channel.name}: would push ${items.length} SKU level(s) ` +
          `(no token/location configured) [${items
            .slice(0, 3)
            .map((i) => `${i.skuCode}=${i.availableToPromise}`)
            .join(', ')}]`,
      );
      return;
    }

    for (const item of items) {
      try {
        const inventoryItemId = await this.resolveInventoryItem(
          channel,
          creds,
          item,
        );
        if (!inventoryItemId) {
          this.log.warn(`${channel.name}: no Shopify variant for SKU ${item.skuCode}`);
          continue;
        }
        await this.client.setAvailable(
          creds,
          inventoryItemId,
          cfg.inventoryLocationGid,
          item.availableToPromise,
        );
      } catch (err) {
        this.log.error(
          `${channel.name}: push failed for ${item.skuCode}: ${(err as Error).message}`,
        );
        throw err;
      }
    }
    this.log.log(`${channel.name}: pushed ${items.length} SKU level(s) to Shopify`);
  }

  private async resolveInventoryItem(
    channel: SalesChannel,
    creds: ShopifyCreds,
    item: InventoryPush,
  ): Promise<string | null> {
    const existing = await this.prisma.channelSkuMapping.findUnique({
      where: { channelId_skuId: { channelId: channel.id, skuId: item.skuId } },
    });
    if (existing) return existing.inventoryItemId;

    const found = await this.client.findInventoryItemBySku(creds, item.skuCode);
    if (!found) return null;

    await this.prisma.channelSkuMapping.upsert({
      where: { channelId_skuId: { channelId: channel.id, skuId: item.skuId } },
      create: {
        channelId: channel.id,
        skuId: item.skuId,
        inventoryItemId: found.inventoryItemId,
        variantId: found.variantId,
      },
      update: {
        inventoryItemId: found.inventoryItemId,
        variantId: found.variantId,
      },
    });
    return found.inventoryItemId;
  }
}

/** Generic logging connector for non-Shopify channels (stub). */
@Injectable()
export class GenericConnector {
  private readonly log = new Logger('GenericConnector');

  make(type: ChannelType): ChannelConnector {
    const log = this.log;
    return {
      type,
      async pushInventory(channel, items): Promise<void> {
        log.log(`→ ${type} "${channel.name}": ${items.length} SKU level(s)`);
      },
    };
  }
}
