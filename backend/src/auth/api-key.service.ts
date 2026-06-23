import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ApiKey, ApiRole } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface AuthContext {
  tenantId: string;
  role: ApiRole;
  keyId: string;
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Mint a new key. The raw secret is returned ONCE and never stored. */
  async create(
    tenantId: string,
    name: string,
    role: ApiRole,
  ): Promise<{ apiKey: ApiKey; secret: string }> {
    const secret = `oms_${randomBytes(24).toString('hex')}`;
    const apiKey = await this.prisma.apiKey.create({
      data: {
        tenantId,
        name,
        role,
        keyHash: ApiKeyService.hash(secret),
        prefix: secret.slice(0, 12),
      },
    });
    return { apiKey, secret };
  }

  list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        prefix: true,
        role: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  /** Activate or revoke (deactivate) a key. */
  async setActive(tenantId: string, id: string, active: boolean): Promise<ApiKey> {
    const key = await this.prisma.apiKey.findFirst({ where: { id, tenantId } });
    if (!key) throw new NotFoundException(`API key ${id} not found`);
    return this.prisma.apiKey.update({ where: { id }, data: { active } });
  }

  /** Resolve a raw key to its auth context, or null if invalid/inactive. */
  async verify(raw: string): Promise<AuthContext | null> {
    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: ApiKeyService.hash(raw) },
    });
    if (!key || !key.active) return null;
    // Best-effort last-used stamp; don't block the request on it.
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { tenantId: key.tenantId, role: key.role, keyId: key.id };
  }
}
