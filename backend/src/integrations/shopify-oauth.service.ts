import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ChannelType, Prisma } from '@prisma/client';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { ShopifyAdminClient } from '../sync/connectors/shopify-admin.client';
import { verifyQueryHmac } from './shopify-hmac.util';

const STATE_TTL_SECONDS = 600;
const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * Shopify OAuth (authorization-code grant). install → Shopify consent → callback
 * exchanges the code for an offline admin token, which we store on the tenant's
 * SHOPIFY SalesChannel. State nonce is held in Redis to defend against CSRF.
 */
@Injectable()
export class ShopifyOAuthService {
  private readonly log = new Logger(ShopifyOAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly client: ShopifyAdminClient,
    private readonly crypto: CryptoService,
  ) {}

  /** Build the Shopify authorize URL and stash a state nonce bound to the tenant. */
  async buildInstallUrl(shop: string, tenantSlug: string): Promise<string> {
    this.assertShop(shop);
    const apiKey = this.require('SHOPIFY_API_KEY');
    const scopes = this.config.get<string>('SHOPIFY_SCOPES', '');
    const baseUrl = this.config.get<string>('APP_BASE_URL', 'http://localhost:3000');

    const tenant = await this.prisma.tenant.findFirst({
      where: { OR: [{ slug: tenantSlug }, { id: tenantSlug }] },
      select: { id: true },
    });
    if (!tenant) throw new BadRequestException(`Unknown tenant: ${tenantSlug}`);

    const state = randomUUID();
    await this.redis.setEx(
      `oauth:shopify:${state}`,
      JSON.stringify({ shop, tenantId: tenant.id }),
      STATE_TTL_SECONDS,
    );

    const redirectUri = `${baseUrl}/oauth/shopify/callback`;
    const params = new URLSearchParams({
      client_id: apiKey,
      scope: scopes,
      redirect_uri: redirectUri,
      state,
    });
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  }

  /** Handle the OAuth callback: verify, exchange token, persist the channel. */
  async handleCallback(
    query: Record<string, string | undefined>,
  ): Promise<{ channelId: string; shop: string }> {
    const { shop, code, state } = query;
    if (!shop || !code || !state) {
      throw new BadRequestException('Missing shop/code/state');
    }
    this.assertShop(shop);

    const apiKey = this.require('SHOPIFY_API_KEY');
    const apiSecret = this.require('SHOPIFY_API_SECRET');

    if (!verifyQueryHmac(query, apiSecret)) {
      throw new UnauthorizedException('Invalid OAuth HMAC');
    }

    const stored = await this.redis.get(`oauth:shopify:${state}`);
    if (!stored) throw new UnauthorizedException('Invalid or expired state');
    const { shop: stateShop, tenantId } = JSON.parse(stored) as {
      shop: string;
      tenantId: string;
    };
    if (stateShop !== shop) {
      throw new UnauthorizedException('State/shop mismatch');
    }
    await this.redis.del(`oauth:shopify:${state}`);

    const token = await this.client.exchangeCodeForToken(
      shop,
      apiKey,
      apiSecret,
      code,
    );

    const apiVersion = this.config.get<string>('SHOPIFY_API_VERSION', '2026-04');
    const config = {
      shopDomain: shop,
      accessToken: this.crypto.encrypt(token.access_token),
      apiVersion,
      scopes: token.scope,
    } as Prisma.InputJsonValue;

    // Upsert by externalRef (shop domain) within the tenant.
    const existing = await this.prisma.salesChannel.findFirst({
      where: { tenantId, externalRef: shop },
    });
    const channel = existing
      ? await this.prisma.salesChannel.update({
          where: { id: existing.id },
          data: { config, active: true },
        })
      : await this.prisma.salesChannel.create({
          data: {
            tenantId,
            type: ChannelType.SHOPIFY,
            name: shop,
            externalRef: shop,
            config,
          },
        });

    this.log.log(`Connected Shopify shop ${shop} to tenant ${tenantId}`);
    return { channelId: channel.id, shop };
  }

  private assertShop(shop: string): void {
    if (!SHOP_DOMAIN_RE.test(shop)) {
      throw new BadRequestException(`Invalid shop domain: ${shop}`);
    }
  }

  private require(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new BadRequestException(`${key} is not configured`);
    return v;
  }
}
