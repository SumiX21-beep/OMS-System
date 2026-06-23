import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  makePage,
  Page,
  PaginationQueryDto,
  toSkipTake,
} from '../common/pagination';
import {
  CreateLocationDto,
  CreateSkuDto,
  UpdateLocationDto,
  UpdateSkuDto,
} from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ── SKUs ──
  async listSkus(tenantId: string, q: PaginationQueryDto): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.SkuWhereInput = {
      tenantId,
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.sku.findMany({ where, skip, take, orderBy: { code: 'asc' } }),
      this.prisma.sku.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  getSku(tenantId: string, id: string) {
    return this.requireSku(tenantId, id);
  }

  createSku(tenantId: string, dto: CreateSkuDto) {
    return this.prisma.sku.create({ data: { tenantId, ...dto } });
  }

  async updateSku(tenantId: string, id: string, dto: UpdateSkuDto) {
    await this.requireSku(tenantId, id);
    return this.prisma.sku.update({ where: { id }, data: dto });
  }

  // ── Locations ──
  async listLocations(
    tenantId: string,
    q: PaginationQueryDto,
  ): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where: Prisma.LocationWhereInput = {
      tenantId,
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        skip,
        take,
        orderBy: { fulfillmentPriority: 'asc' },
      }),
      this.prisma.location.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  getLocation(tenantId: string, id: string) {
    return this.requireLocation(tenantId, id);
  }

  createLocation(tenantId: string, dto: CreateLocationDto) {
    return this.prisma.location.create({ data: { tenantId, ...dto } });
  }

  async updateLocation(tenantId: string, id: string, dto: UpdateLocationDto) {
    await this.requireLocation(tenantId, id);
    return this.prisma.location.update({ where: { id }, data: dto });
  }

  private async requireSku(tenantId: string, id: string) {
    const sku = await this.prisma.sku.findFirst({ where: { id, tenantId } });
    if (!sku) throw new NotFoundException(`SKU ${id} not found`);
    return sku;
  }

  private async requireLocation(tenantId: string, id: string) {
    const loc = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!loc) throw new NotFoundException(`Location ${id} not found`);
    return loc;
  }
}
