import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/pagination';
import { TenantId } from '../common/tenant/tenant.decorator';
import { CatalogService } from './catalog.service';
import {
  CreateLocationDto,
  CreateSkuDto,
  UpdateLocationDto,
  UpdateSkuDto,
} from './dto/catalog.dto';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ── SKUs ──
  @Get('skus')
  listSkus(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.catalog.listSkus(tenantId, q);
  }

  @Get('skus/:id')
  getSku(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.getSku(tenantId, id);
  }

  @Post('skus')
  createSku(@TenantId() tenantId: string, @Body() dto: CreateSkuDto) {
    return this.catalog.createSku(tenantId, dto);
  }

  @Patch('skus/:id')
  updateSku(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSkuDto,
  ) {
    return this.catalog.updateSku(tenantId, id, dto);
  }

  // ── Locations ──
  @Get('locations')
  listLocations(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.catalog.listLocations(tenantId, q);
  }

  @Get('locations/:id')
  getLocation(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalog.getLocation(tenantId, id);
  }

  @Post('locations')
  createLocation(@TenantId() tenantId: string, @Body() dto: CreateLocationDto) {
    return this.catalog.createLocation(tenantId, dto);
  }

  @Patch('locations/:id')
  updateLocation(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.catalog.updateLocation(tenantId, id, dto);
  }
}
