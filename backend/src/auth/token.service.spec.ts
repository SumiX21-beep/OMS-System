import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { ApiRole } from '@prisma/client';
import { TokenService } from './token.service';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string, def?: T): T =>
      (values[key] as unknown as T) ?? (def as T),
  } as unknown as ConfigService;
}

const claims = {
  sub: 'u1',
  tenantId: 't1',
  role: ApiRole.OPERATOR,
  email: 'a@demo.test',
};

describe('TokenService', () => {
  it('is disabled without a secret', () => {
    const svc = new TokenService(configWith({}));
    expect(svc.enabled).toBe(false);
  });

  it('signs and verifies a round-trip token', () => {
    const svc = new TokenService(configWith({ JWT_SECRET: 'test-secret-abc' }));
    expect(svc.enabled).toBe(true);
    const token = svc.sign(claims);
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
    const decoded = svc.verify(token);
    expect(decoded.sub).toBe('u1');
    expect(decoded.tenantId).toBe('t1');
    expect(decoded.role).toBe(ApiRole.OPERATOR);
  });

  it('rejects a token signed with a different secret', () => {
    const a = new TokenService(configWith({ JWT_SECRET: 'secret-A' }));
    const b = new TokenService(configWith({ JWT_SECRET: 'secret-B' }));
    const token = a.sign(claims);
    expect(() => b.verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects a tampered token', () => {
    const svc = new TokenService(configWith({ JWT_SECRET: 's' }));
    const token = svc.sign(claims);
    expect(() => svc.verify(token + 'x')).toThrow(UnauthorizedException);
  });
});
