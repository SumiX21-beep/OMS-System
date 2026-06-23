import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PaginationQueryDto } from '../common/pagination';
import { TenantId } from '../common/tenant/tenant.decorator';
import {
  CreateSourcingRuleDto,
  UpdateSourcingRuleDto,
} from './dto/sourcing-rule.dto';
import { SourcingRuleService } from './sourcing-rule.service';

@Controller('sourcing-rules')
export class SourcingRuleController {
  constructor(private readonly rules: SourcingRuleService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.rules.list(tenantId, q);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateSourcingRuleDto) {
    return this.rules.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSourcingRuleDto,
  ) {
    return this.rules.update(tenantId, id, dto);
  }
}
