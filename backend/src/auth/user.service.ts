import { ConflictException, Injectable } from '@nestjs/common';
import { ApiRole, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';

const BCRYPT_ROUNDS = 10;

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  role?: ApiRole;
}

/** Public projection of a user (never exposes the password hash). */
export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  private static strip(user: User): SafeUser {
    const { passwordHash: _omit, ...safe } = user;
    void _omit;
    return safe;
  }

  /** Create a user within a tenant (password hashed with bcrypt). */
  async create(tenantId: string, input: CreateUserInput): Promise<SafeUser> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (existing) {
      throw new ConflictException(`User ${email} already exists`);
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash,
        name: input.name,
        role: input.role ?? ApiRole.OPERATOR,
      },
    });
    return UserService.strip(user);
  }

  /** Verify email/password within a tenant; returns the user or null. */
  async verifyCredentials(
    tenantId: string,
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: email.trim().toLowerCase() } },
    });
    if (!user || !user.active) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    void this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);
    return user;
  }

  async list(tenantId: string): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return users.map(UserService.strip);
  }

  async setActive(
    tenantId: string,
    id: string,
    active: boolean,
  ): Promise<SafeUser> {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new ConflictException(`User ${id} not found`);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { active },
    });
    return UserService.strip(updated);
  }
}
