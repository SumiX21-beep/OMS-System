import { Controller, Get } from '@nestjs/common';
import { ApiRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantId } from '../common/tenant/tenant.decorator';
import { CurrentRole } from './current-role.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Who am I — tenant + role for the presented credentials. */
  @Get('me')
  async me(@TenantId() tenantId: string, @CurrentRole() role: ApiRole) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true },
    });
    return { tenant, role };
  }
}
