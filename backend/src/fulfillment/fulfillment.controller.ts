import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant/tenant.decorator';
import {
  CreateReturnDto,
  ReturnListQueryDto,
  ShipmentListQueryDto,
  ShipShipmentDto,
} from './dto/fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';
import { ReturnsService } from './returns.service';

@Controller()
export class FulfillmentController {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly returns: ReturnsService,
  ) {}

  @Get('shipments')
  listShipments(
    @TenantId() tenantId: string,
    @Query() q: ShipmentListQueryDto,
  ) {
    return this.fulfillment.listShipments(tenantId, q);
  }

  @Post('shipments/:id/pick')
  pick(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.pick(tenantId, id);
  }

  @Post('shipments/:id/ship')
  ship(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ShipShipmentDto,
  ) {
    return this.fulfillment.ship(tenantId, id, dto.carrier);
  }

  @Post('shipments/:id/deliver')
  deliver(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.deliver(tenantId, id);
  }

  @Post('shipments/:id/dispatch')
  dispatch(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.dispatch(tenantId, id);
  }

  @Post('shipments/:id/ready')
  ready(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.markReadyForPickup(tenantId, id);
  }

  @Post('shipments/:id/pickup')
  pickup(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.fulfillment.pickUp(tenantId, id);
  }

  @Get('returns')
  listReturns(@TenantId() tenantId: string, @Query() q: ReturnListQueryDto) {
    return this.returns.list(tenantId, q);
  }

  @Post('returns')
  createReturn(@TenantId() tenantId: string, @Body() dto: CreateReturnDto) {
    return this.returns.create(tenantId, dto);
  }

  @Post('returns/:id/receive')
  receiveReturn(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.returns.receive(tenantId, id);
  }
}
