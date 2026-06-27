import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantId } from '../common/tenant/tenant.decorator';
import { CurrentRole } from './current-role.decorator';
import { LoginDto, RegisterUserDto } from './dto/auth.dto';
import { TokenService } from './token.service';
import { UserService } from './user.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Email/password login → short-lived JWT. Public (no auth) — the tenant is
   * named in the body and the user proves identity with their password.
   */
  @Post('login')
  async login(@Body() dto: LoginDto) {
    if (!this.tokens.enabled) {
      throw new ServiceUnavailableException(
        'End-user login is not configured (set JWT_SECRET).',
      );
    }
    const tenant = await this.prisma.tenant.findFirst({
      where: { OR: [{ id: dto.tenant }, { slug: dto.tenant }] },
      select: { id: true, slug: true, name: true },
    });
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    const user = await this.users.verifyCredentials(
      tenant.id,
      dto.email,
      dto.password,
    );
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.tokens.sign({
      sub: user.id,
      tenantId: tenant.id,
      role: user.role,
      email: user.email,
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.ttl,
      role: user.role,
      user: { id: user.id, email: user.email, name: user.name },
      tenant,
    };
  }

  /** Create a console user in the caller's tenant. ADMIN only. */
  @Post('register')
  async register(
    @TenantId() tenantId: string,
    @CurrentRole() role: ApiRole,
    @Body() dto: RegisterUserDto,
  ) {
    if (role !== ApiRole.ADMIN) {
      throw new ForbiddenException('Admin role required to create users');
    }
    return this.users.create(tenantId, dto);
  }

  /** List console users in the caller's tenant. ADMIN only. */
  @Get('users')
  async listUsers(
    @TenantId() tenantId: string,
    @CurrentRole() role: ApiRole,
  ) {
    if (role !== ApiRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }
    return this.users.list(tenantId);
  }

  /** Who am I — tenant + role for the presented credentials (key or JWT). */
  @Get('me')
  async me(@TenantId() tenantId: string, @CurrentRole() role: ApiRole) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true },
    });
    return { tenant, role };
  }
}
