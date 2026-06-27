import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiRole } from '@prisma/client';
import jwt from 'jsonwebtoken';

/** Claims carried in the access token; mirror the API-key auth context. */
export interface JwtClaims {
  sub: string; // user id
  tenantId: string;
  role: ApiRole;
  email: string;
}

/**
 * Self-hosted JWT issuer/verifier (HS256). End users log in with email/password
 * and receive a short-lived access token; this signs and verifies it. Disabled
 * (login returns 503) until JWT_SECRET is set.
 */
@Injectable()
export class TokenService {
  private readonly log = new Logger(TokenService.name);
  private readonly secret: string;
  private readonly expiresIn: string;
  readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('JWT_SECRET', '');
    this.expiresIn = config.get<string>('JWT_EXPIRES_IN', '12h');
    this.enabled = this.secret.length > 0;
    if (!this.enabled) {
      this.log.warn('JWT_SECRET unset — end-user (email/password) login is disabled.');
    }
  }

  get ttl(): string {
    return this.expiresIn;
  }

  sign(claims: JwtClaims): string {
    return jwt.sign(claims, this.secret, {
      expiresIn: this.expiresIn,
    } as jwt.SignOptions);
  }

  verify(token: string): JwtClaims {
    try {
      return jwt.verify(token, this.secret) as JwtClaims;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
