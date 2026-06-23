import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ShopifyOAuthService } from './shopify-oauth.service';

/**
 * Shopify OAuth endpoints. Not tenant-scoped (no x-tenant-id): the tenant is
 * carried through the OAuth `state` nonce instead.
 */
@Controller('oauth/shopify')
export class OAuthController {
  constructor(private readonly oauth: ShopifyOAuthService) {}

  /** Begin install: redirect the merchant to Shopify's consent screen. */
  @Get('install')
  async install(
    @Query('shop') shop: string,
    @Query('tenant') tenant: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.oauth.buildInstallUrl(shop, tenant);
    res.redirect(302, url);
  }

  /** OAuth redirect target: verify, exchange the code, store the token. */
  @Get('callback')
  async callback(@Req() req: Request): Promise<{ ok: boolean; channelId: string }> {
    const result = await this.oauth.handleCallback(
      req.query as Record<string, string | undefined>,
    );
    return { ok: true, channelId: result.channelId };
  }
}
