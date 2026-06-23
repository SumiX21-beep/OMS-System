import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { TenantId } from '../common/tenant/tenant.decorator';
import { ApiKeyService } from './api-key.service';

class CreateApiKeyDto {
  @IsString() name!: string;
  @IsOptional() @IsEnum(ApiRole) role?: ApiRole;
}

class UpdateApiKeyDto {
  @IsBoolean() active!: boolean;
}

/** API-key management. Mounted under /admin so it requires an ADMIN key. */
@Controller('admin/api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  /** Mint a key — the raw `secret` is returned once and never retrievable again. */
  @Post()
  async create(@TenantId() tenantId: string, @Body() dto: CreateApiKeyDto) {
    const { apiKey, secret } = await this.apiKeys.create(
      tenantId,
      dto.name,
      dto.role ?? ApiRole.OPERATOR,
    );
    return {
      id: apiKey.id,
      name: apiKey.name,
      role: apiKey.role,
      prefix: apiKey.prefix,
      secret, // shown once
    };
  }

  @Get()
  list(@TenantId() tenantId: string) {
    return this.apiKeys.list(tenantId);
  }

  /** Revoke or reactivate a key. */
  @Patch(':id')
  setActive(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.apiKeys.setActive(tenantId, id, dto.active);
  }
}
