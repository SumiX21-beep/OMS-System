import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderChannel, OrderStatus, SalesChannel } from '@prisma/client';
import { CryptoService } from '../common/crypto/crypto.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CreateOrderDto, OrderLineDto } from '../orders/dto/order.dto';
import { verifyGenericHmac, verifyWebhookHmac } from './shopify-hmac.util';

interface ShopifyLineItem {
  sku?: string;
  quantity?: number;
  price?: string;
}
interface ShopifyOrderPayload {
  id: number | string;
  name?: string;
  customer?: { id?: number | string };
  line_items?: ShopifyLineItem[];
}

interface GenericOrderPayload {
  externalRef: string;
  customerRef?: string;
  lines: { sku: string; quantity: number; unitPrice?: number }[];
}

@Injectable()
export class WebhookService {
  private readonly log = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  // ── Shopify ────────────────────────────────────────────────────────────────

  /**
   * Verify (raw-body HMAC with the app's shared secret) and process a Shopify
   * webhook. Returns quickly; callers should already have responded 2xx for
   * non-auth failures per Shopify guidance.
   */
  async handleShopify(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ status: string }> {
    const secret = this.config.get<string>('SHOPIFY_API_SECRET', '');
    if (!verifyWebhookHmac(rawBody, headers['x-shopify-hmac-sha256'], secret)) {
      throw new UnauthorizedException('Invalid webhook HMAC');
    }

    const topic = headers['x-shopify-topic'] ?? '';
    const shop = headers['x-shopify-shop-domain'] ?? '';
    const webhookId = headers['x-shopify-webhook-id'] ?? '';

    const channel = await this.prisma.salesChannel.findFirst({
      where: { externalRef: shop, type: 'SHOPIFY' },
    });
    if (!channel) {
      this.log.warn(`Webhook for unknown shop ${shop} (topic ${topic})`);
      return { status: 'ignored-unknown-shop' };
    }

    const payload = JSON.parse(rawBody.toString('utf8'));

    // Dedupe on the stable webhook id across retries.
    const result = await this.idempotency.run(
      channel.tenantId,
      `webhook.shopify.${topic}`,
      webhookId || undefined,
      payload,
      () => this.routeShopify(topic, channel, payload as ShopifyOrderPayload),
    );
    return result.body;
  }

  private async routeShopify(
    topic: string,
    channel: SalesChannel,
    payload: ShopifyOrderPayload,
  ): Promise<{ status: string }> {
    switch (topic) {
      case 'orders/create':
        return this.ingestOrder(channel, payload, OrderChannel.WEB);
      case 'orders/cancelled':
        return this.cancelByExternalRef(channel, String(payload.id));
      default:
        this.log.log(`Unhandled Shopify topic ${topic}`);
        return { status: `ignored-${topic}` };
    }
  }

  private async ingestOrder(
    channel: SalesChannel,
    payload: ShopifyOrderPayload,
    orderChannel: OrderChannel,
  ): Promise<{ status: string }> {
    const lines = await this.mapLines(
      channel.tenantId,
      (payload.line_items ?? []).map((li) => ({
        sku: li.sku ?? '',
        quantity: li.quantity ?? 0,
        unitPrice: li.price ? Math.round(parseFloat(li.price) * 100) : 0,
      })),
    );
    if (!lines.length) {
      this.log.warn(`Order ${payload.id}: no mappable SKUs, skipping`);
      return { status: 'skipped-no-known-skus' };
    }

    const dto: CreateOrderDto = {
      channel: orderChannel,
      externalRef: String(payload.id),
      customerRef: payload.customer?.id ? String(payload.customer.id) : undefined,
      lines,
    };
    const order = await this.orders.create(channel.tenantId, dto);
    this.log.log(`Ingested Shopify order ${payload.id} → ${order.id}`);
    return { status: 'order-created' };
  }

  private async cancelByExternalRef(
    channel: SalesChannel,
    externalRef: string,
  ): Promise<{ status: string }> {
    const order = await this.prisma.order.findFirst({
      where: { tenantId: channel.tenantId, externalRef },
    });
    if (!order) return { status: 'cancel-no-such-order' };
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.RETURNED
    ) {
      return { status: 'already-terminal' };
    }
    await this.orders.cancel(channel.tenantId, order.id, 'shopify cancellation');
    return { status: 'order-cancelled' };
  }

  // ── Generic signed marketplace webhook ──────────────────────────────────────

  async handleGeneric(
    channelId: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ status: string }> {
    const channel = await this.prisma.salesChannel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new BadRequestException('Unknown channel');

    const storedSecret = (channel.config as { webhookSecret?: string } | null)
      ?.webhookSecret;
    if (!storedSecret) throw new BadRequestException('Channel has no webhookSecret');
    const secret = this.crypto.decrypt(storedSecret);
    if (!verifyGenericHmac(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as GenericOrderPayload;
    const lines = await this.mapLines(channel.tenantId, payload.lines ?? []);
    if (!lines.length) return { status: 'skipped-no-known-skus' };

    const dto: CreateOrderDto = {
      channel: OrderChannel.MARKETPLACE,
      externalRef: payload.externalRef,
      customerRef: payload.customerRef,
      lines,
    };
    await this.idempotency.run(
      channel.tenantId,
      'webhook.generic',
      payload.externalRef,
      payload,
      () => this.orders.create(channel.tenantId, dto),
    );
    return { status: 'order-created' };
  }

  // ── Shared SKU mapping ──────────────────────────────────────────────────────

  /** Map external SKU codes to OMS sku ids; silently drop unknown SKUs. */
  private async mapLines(
    tenantId: string,
    raw: { sku: string; quantity: number; unitPrice?: number }[],
  ): Promise<OrderLineDto[]> {
    const codes = [...new Set(raw.map((l) => l.sku).filter(Boolean))];
    const skus = await this.prisma.sku.findMany({
      where: { tenantId, code: { in: codes } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(skus.map((s) => [s.code, s.id]));

    const out: OrderLineDto[] = [];
    for (const l of raw) {
      const skuId = idByCode.get(l.sku);
      if (!skuId || l.quantity < 1) continue;
      out.push({ skuId, quantity: l.quantity, unitPrice: l.unitPrice ?? 0 });
    }
    return out;
  }
}
