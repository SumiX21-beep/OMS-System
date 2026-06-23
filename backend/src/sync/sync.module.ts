import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ConnectorRegistry } from './connector.registry';
import {
  GenericConnector,
  ShopifyConnector,
} from './connectors/channel-connector';
import { ShopifyAdminClient } from './connectors/shopify-admin.client';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [InventoryModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    ConnectorRegistry,
    ShopifyConnector,
    GenericConnector,
    ShopifyAdminClient,
  ],
  exports: [SyncService, ShopifyAdminClient],
})
export class SyncModule {}
