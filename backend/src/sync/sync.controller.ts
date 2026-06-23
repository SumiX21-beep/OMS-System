import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import {
  ChangesQueryDto,
  CreateChannelDto,
  OutboxListQueryDto,
} from './dto/sync.dto';
import { SyncService } from './sync.service';

@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  // ── Channel administration ──
  @Post('channels')
  createChannel(@TenantId() tenantId: string, @Body() dto: CreateChannelDto) {
    return this.sync.createChannel(tenantId, dto);
  }

  @Get('channels')
  listChannels(@TenantId() tenantId: string) {
    return this.sync.listChannels(tenantId);
  }

  // ── Source-of-truth feeds consumed by StockShield ──

  /** Full canonical ATP snapshot. */
  @Get('sync/inventory')
  inventoryFeed(@TenantId() tenantId: string) {
    return this.sync.inventoryFeed(tenantId);
  }

  /** Delta feed: changes since a seq cursor. */
  @Get('sync/inventory/changes')
  changes(@TenantId() tenantId: string, @Query() q: ChangesQueryDto) {
    return this.sync.changesSince(tenantId, q);
  }

  /** Outbox monitoring view. */
  @Get('sync/outbox')
  outbox(@TenantId() tenantId: string, @Query() q: OutboxListQueryDto) {
    return this.sync.listOutbox(tenantId, q);
  }

  /** Manually drain pending outbox events to channels now. */
  @Post('sync/drain')
  async drain() {
    const published = await this.sync.drainOutbox();
    return { published };
  }
}
