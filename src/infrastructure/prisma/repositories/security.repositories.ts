import { Prisma, User } from '@prisma/client';
import { RefreshTokenRecord, UserRecord } from '../../../domain/repositories/records';
import {
  NewUser,
  PageRequest,
  Paged,
  RefreshTokenRepository,
  UserPatch,
  UserRepository,
} from '../../../domain/repositories/repositories';
import { Role } from '../../../domain/shared/enums';
import { Db } from '../support';

function toUser(u: User): UserRecord {
  return {
    id: u.id,
    email: u.email,
    passwordHash: u.passwordHash,
    fullName: u.fullName,
    role: u.role as Role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<UserRecord | null> {
    const u = await this.db.user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const u = await this.db.user.findUnique({ where: { email } });
    return u ? toUser(u) : null;
  }

  async list(filter: { role?: Role; isActive?: boolean }, page: PageRequest): Promise<Paged<UserRecord>> {
    const where: Prisma.UserWhereInput = {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { email: 'asc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.user.count({ where }),
    ]);
    return { items: items.map(toUser), total };
  }

  async create(data: NewUser): Promise<UserRecord> {
    return toUser(await this.db.user.create({ data }));
  }

  async update(id: string, patch: UserPatch): Promise<UserRecord> {
    return toUser(await this.db.user.update({ where: { id }, data: patch }));
  }

  async countActiveAdmins(): Promise<number> {
    return this.db.user.count({ where: { role: 'ADMIN', isActive: true } });
  }
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Db) {}

  async create(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<RefreshTokenRecord> {
    const t = await this.db.refreshToken.create({ data });
    return { id: t.id, userId: t.userId, tokenHash: t.tokenHash, familyId: t.familyId, expiresAt: t.expiresAt, revokedAt: t.revokedAt, createdAt: t.createdAt };
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const t = await this.db.refreshToken.findUnique({ where: { tokenHash } });
    return t
      ? { id: t.id, userId: t.userId, tokenHash: t.tokenHash, familyId: t.familyId, expiresAt: t.expiresAt, revokedAt: t.revokedAt, createdAt: t.createdAt }
      : null;
  }

  async revokeIfActive(id: string, at: Date): Promise<boolean> {
    const res = await this.db.refreshToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
    return res.count === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    return (await this.db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: at } })).count;
  }

  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    return (await this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } })).count;
  }
}
