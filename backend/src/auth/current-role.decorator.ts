import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiRole } from '@prisma/client';
import { Request } from 'express';

/** Injects the RBAC role resolved by AuthGuard. */
export const CurrentRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiRole => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.apiRole ?? ApiRole.READ_ONLY;
  },
);
