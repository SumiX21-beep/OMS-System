import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { TenantId } from '../common/tenant/tenant.decorator';
import { CreateOrderDto, OrderListQueryDto } from './dto/order.dto';
import { OrdersService } from './orders.service';
import { ReservationService } from './reservations.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly reservations: ReservationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Idempotent order capture — retried webhooks/redeliveries won't double-create. */
  @Post()
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.idempotency.run(
      tenantId,
      'orders.create',
      idempotencyKey,
      dto,
      () => this.orders.create(tenantId, dto),
    );
    return result.body;
  }

  @Get()
  list(@TenantId() tenantId: string, @Query() q: OrderListQueryDto) {
    return this.orders.list(tenantId, q);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.get(tenantId, id);
  }

  @Post(':id/validate')
  validate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.validate(tenantId, id);
  }

  @Post(':id/reserve')
  async reserve(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.orders.get(tenantId, id); // tenant scope check
    return this.reservations.reserveForOrder(id);
  }

  @Post(':id/release')
  release(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.transition(tenantId, id, 'RELEASED', 'released to fulfilment');
  }

  @Post(':id/cancel')
  cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('note') note?: string,
  ) {
    return this.orders.cancel(tenantId, id, note);
  }
}
