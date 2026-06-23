import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';

/** API-key auth + RBAC. The guard is registered globally for all routes. */
@Global()
@Module({
  controllers: [ApiKeyController, AuthController],
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [ApiKeyService],
})
export class AuthModule {}
