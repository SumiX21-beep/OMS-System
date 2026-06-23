import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import { AtpService } from './atp.service';
import { InboundService } from './inbound.service';
import { InventoryService } from './inventory.service';
import {
  AdjustStockDto,
  AvailabilityQueryDto,
  InboundDto,
  InboundListQueryDto,
  ReceiveInboundDto,
  ReceiveStockDto,
  SafetyStockDto,
  SnapshotListQueryDto,
  TransferStockDto,
} from './dto/inventory.dto';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly atp: AtpService,
    private readonly inbound: InboundService,
  ) {}

  @Post('receipts')
  receive(@TenantId() tenantId: string, @Body() dto: ReceiveStockDto) {
    return this.inventory.receive({ tenantId, ...dto });
  }

  @Post('adjustments')
  adjust(@TenantId() tenantId: string, @Body() dto: AdjustStockDto) {
    return this.inventory.adjust({ tenantId, ...dto });
  }

  @Post('inbound')
  createInbound(@TenantId() tenantId: string, @Body() dto: InboundDto) {
    return this.inbound.create({
      tenantId,
      skuId: dto.skuId,
      locationId: dto.locationId,
      quantity: dto.quantity,
      expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : undefined,
      reference: dto.reference,
    });
  }

  @Post('inbound/receive')
  receiveInbound(
    @TenantId() tenantId: string,
    @Body() dto: ReceiveInboundDto,
  ) {
    return this.inbound.receive(tenantId, dto.inboundId, dto.quantity);
  }

  @Post('safety-stock')
  async safetyStock(@TenantId() tenantId: string, @Body() dto: SafetyStockDto) {
    await this.inventory.setSafetyStock({ tenantId, ...dto });
    return { ok: true };
  }

  @Post('transfers')
  async transfer(@TenantId() tenantId: string, @Body() dto: TransferStockDto) {
    await this.inventory.transfer({ tenantId, ...dto });
    return { ok: true };
  }

  /** Paginated snapshot list (with derived available) for inventory tables. */
  @Get('snapshots')
  snapshots(@TenantId() tenantId: string, @Query() q: SnapshotListQueryDto) {
    return this.inventory.listSnapshots(tenantId, q);
  }

  @Get('inbound')
  listInbound(@TenantId() tenantId: string, @Query() q: InboundListQueryDto) {
    return this.inbound.list(tenantId, q);
  }

  /** Real-time availability read — single rollup, per-location, or breakdown. */
  @Get('availability')
  async availability(
    @TenantId() tenantId: string,
    @Query() q: AvailabilityQueryDto,
  ) {
    if (q.breakdown) {
      return this.atp.breakdown(tenantId, q.skuId);
    }
    if (q.locationId) {
      return this.atp.atLocation(tenantId, q.skuId, q.locationId);
    }
    return this.atp.network(tenantId, q.skuId);
  }
}
