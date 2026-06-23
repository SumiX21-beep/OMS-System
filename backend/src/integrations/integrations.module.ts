import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SyncModule } from '../sync/sync.module';
import { OAuthController } from './oauth.controller';
import { ShopifyOAuthService } from './shopify-oauth.service';
import { WebhookService } from './webhook.service';
import { WebhooksController } from './webhooks.controller';

/** Real channel integration: Shopify OAuth + inbound signed webhooks. */
@Module({
  imports: [OrdersModule, SyncModule],
  controllers: [OAuthController, WebhooksController],
  providers: [ShopifyOAuthService, WebhookService],
})
export class IntegrationsModule {}
