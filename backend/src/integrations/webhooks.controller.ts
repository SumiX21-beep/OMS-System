import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { WebhookService } from './webhook.service';

/**
 * Inbound webhooks. Not tenant-scoped — the tenant is resolved from the
 * verified channel. HMAC is computed over the *raw* body (NestFactory is
 * created with rawBody:true), so these handlers read req.rawBody.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post('shopify')
  @HttpCode(200)
  shopify(@Req() req: Request): Promise<{ status: string }> {
    const headers = req.headers as Record<string, string | undefined>;
    return this.webhooks.handleShopify(this.raw(req), headers);
  }

  @Post('marketplace/:channelId')
  @HttpCode(200)
  marketplace(
    @Param('channelId') channelId: string,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    const signature = req.header('x-signature');
    return this.webhooks.handleGeneric(channelId, this.raw(req), signature);
  }

  private raw(req: Request): Buffer {
    // Populated by NestFactory.create(..., { rawBody: true }).
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    return raw ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
  }
}
