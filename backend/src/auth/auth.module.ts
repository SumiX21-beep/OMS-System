import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { TokenService } from './token.service';
import { UserService } from './user.service';

/**
 * Auth: API keys (machine-to-machine) + end-user JWT login, both feeding the
 * same RBAC. The guard is registered globally for all routes.
 */
@Global()
@Module({
  controllers: [ApiKeyController, AuthController],
  providers: [
    ApiKeyService,
    UserService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [ApiKeyService, UserService, TokenService],
})
export class AuthModule {}
