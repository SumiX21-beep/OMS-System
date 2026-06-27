import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiRole } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiKeyService } from './api-key.service';
import { TokenService } from './token.service';

declare module 'express-serve-static-core' {
  interface Request {
    tenantId?: string;
    apiRole?: ApiRole;
  }
}

// Paths that authenticate themselves (HMAC/OAuth), log in, or need no tenant.
const PUBLIC_PREFIXES = [
  '/health',
  '/metrics',
  '/webhooks',
  '/oauth',
  '/auth/login',
];

/**
 * Global auth: resolves tenant + role from an API key (`Authorization: Bearer`
 * or `x-api-key`) and enforces coarse RBAC. In dev (AUTH_REQUIRED=false) it
 * falls back to the `x-tenant-id` header with ADMIN role so local flows work
 * without minting keys.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly authRequired: boolean;

  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    config: ConfigService,
  ) {
    this.authRequired = config.get<string>('AUTH_REQUIRED', 'false') === 'true';
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const path = req.path;
    if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
      return true;
    }

    const raw = this.extractKey(req);
    if (raw && this.looksLikeJwt(raw)) {
      // End-user session: a self-hosted JWT carries tenant + role as claims.
      const claims = this.tokens.verify(raw);
      req.tenantId = claims.tenantId;
      req.apiRole = claims.role;
    } else if (raw) {
      const auth = await this.apiKeys.verify(raw);
      if (!auth) throw new UnauthorizedException('Invalid API key');
      req.tenantId = auth.tenantId;
      req.apiRole = auth.role;
    } else if (!this.authRequired) {
      // Dev fallback: trust x-tenant-id as an ADMIN.
      const tenantId = await this.resolveTenantHeader(req);
      req.tenantId = tenantId;
      req.apiRole = ApiRole.ADMIN;
    } else {
      throw new UnauthorizedException('Missing API key');
    }

    this.enforceRbac(req);
    return true;
  }

  private enforceRbac(req: Request): void {
    const role = req.apiRole!;
    const isGet = req.method === 'GET';
    if (role === ApiRole.READ_ONLY && !isGet) {
      throw new ForbiddenException('Read-only key cannot perform writes');
    }
    const path = req.path;
    const adminOnly =
      path.startsWith('/admin') ||
      (path.startsWith('/channels') && !isGet);
    if (adminOnly && role !== ApiRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }
  }

  /** A JWT is three base64url segments separated by dots; API keys have none. */
  private looksLikeJwt(token: string): boolean {
    return token.split('.').length === 3;
  }

  private extractKey(req: Request): string | undefined {
    const header = req.header('authorization');
    if (header?.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim();
    }
    // EventSource (SSE) cannot set headers, so accept the key via query string.
    const q = typeof req.query.apiKey === 'string' ? req.query.apiKey : undefined;
    return req.header('x-api-key') ?? q ?? undefined;
  }

  private async resolveTenantHeader(req: Request): Promise<string> {
    const q = typeof req.query.tenant === 'string' ? req.query.tenant : undefined;
    const raw = req.header('x-tenant-id') ?? q;
    if (!raw) throw new UnauthorizedException('Missing x-tenant-id header');
    const tenant = await this.prisma.tenant.findFirst({
      where: { OR: [{ id: raw }, { slug: raw }] },
      select: { id: true },
    });
    if (!tenant) throw new UnauthorizedException(`Unknown tenant: ${raw}`);
    return tenant.id;
  }
}
