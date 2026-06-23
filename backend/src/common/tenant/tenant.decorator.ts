import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';

/** Injects the tenant id resolved by AuthGuard into a controller handler. */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.tenantId) {
      throw new InternalServerErrorException(
        'Tenant not resolved — is the route covered by AuthGuard?',
      );
    }
    return req.tenantId;
  },
);
