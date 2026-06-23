import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommonModule } from './common/common.module';
import { EventsModule } from './events/events.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { InventoryModule } from './inventory/inventory.module';
import { LoggingInterceptor } from './observability/logging.interceptor';
import { ObservabilityModule } from './observability/observability.module';
import { OrdersModule } from './orders/orders.module';
import { SourcingModule } from './sourcing/sourcing.module';
import { SyncModule } from './sync/sync.module';

/** API process: serves the HTTP surface for all domains. */
@Module({
  imports: [
    CommonModule,
    EventsModule,
    AuthModule,
    ObservabilityModule,
    CatalogModule,
    InventoryModule,
    OrdersModule,
    SourcingModule,
    FulfillmentModule,
    SyncModule,
    AdminModule,
    IntegrationsModule,
    AiModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }],
})
export class AppModule {
  // Tenant + role are resolved by the global AuthGuard (see AuthModule), which
  // also allow-lists health/metrics/webhooks/oauth.
}
