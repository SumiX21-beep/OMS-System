import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { makePage, PaginationQueryDto, toSkipTake } from '../common/pagination';
import {
  CreateSourcingRuleDto,
  UpdateSourcingRuleDto,
} from './dto/sourcing-rule.dto';

@Injectable()
export class SourcingRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, q: PaginationQueryDto) {
    const { skip, take, page, pageSize } = toSkipTake(q);
    const where = { tenantId };
    const [items, total] = await Promise.all([
      this.prisma.sourcingRule.findMany({
        where,
        skip,
        take,
        orderBy: { priority: 'asc' },
      }),
      this.prisma.sourcingRule.count({ where }),
    ]);
    return makePage(items, total, page, pageSize);
  }

  create(tenantId: string, dto: CreateSourcingRuleDto) {
    return this.prisma.sourcingRule.create({ data: { tenantId, ...dto } });
  }

  async update(tenantId: string, id: string, dto: UpdateSourcingRuleDto) {
    const existing = await this.prisma.sourcingRule.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Sourcing rule ${id} not found`);
    return this.prisma.sourcingRule.update({ where: { id }, data: dto });
  }
}
