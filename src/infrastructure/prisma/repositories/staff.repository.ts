import { Prisma, StaffMember, User } from '@prisma/client';
import { StaffMemberRecord } from '../../../domain/repositories/records';
import { StaffMemberData, StaffMemberRepository } from '../../../domain/repositories/repositories';
import { auditMeta, Db, userRefs } from '../support';

type Row = StaffMember & { user: Pick<User, 'id' | 'fullName'> | null };

const include = { user: { select: { id: true, fullName: true } } } as const;

/** Equipo (`staff_members`, Fase 4). */
export class PrismaStaffMemberRepository implements StaffMemberRepository {
  constructor(private readonly db: Db) {}

  private async toRecords(rows: Row[]): Promise<StaffMemberRecord[]> {
    const users = await userRefs(this.db, rows.flatMap((r) => [r.createdById, r.updatedById]));
    return rows.map((s) => ({
      id: s.id,
      displayName: s.displayName,
      userId: s.userId,
      user: s.user ? { id: s.user.id, fullName: s.user.fullName } : null,
      isBonusEligible: s.isBonusEligible,
      isActive: s.isActive,
      sortOrder: s.sortOrder,
      notes: s.notes,
      audit: auditMeta(users, s),
    }));
  }

  private async one(row: Row | null): Promise<StaffMemberRecord | null> {
    return row ? (await this.toRecords([row]))[0]! : null;
  }

  async list(includeInactive: boolean): Promise<StaffMemberRecord[]> {
    const rows = await this.db.staffMember.findMany({
      where: includeInactive ? {} : { isActive: true },
      include,
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    return this.toRecords(rows);
  }

  async findById(id: string): Promise<StaffMemberRecord | null> {
    return this.one(await this.db.staffMember.findUnique({ where: { id }, include }));
  }

  async findByDisplayName(displayName: string, excludeId?: string): Promise<StaffMemberRecord | null> {
    return this.one(
      await this.db.staffMember.findFirst({
        where: { displayName: { equals: displayName, mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
        include,
      }),
    );
  }

  async findByUserId(userId: string, excludeId?: string): Promise<StaffMemberRecord | null> {
    return this.one(
      await this.db.staffMember.findFirst({ where: { userId, ...(excludeId ? { id: { not: excludeId } } : {}) }, include }),
    );
  }

  async create(data: StaffMemberData & { createdById: string | null }): Promise<StaffMemberRecord> {
    const row = await this.db.staffMember.create({
      data: {
        displayName: data.displayName,
        userId: data.userId,
        isBonusEligible: data.isBonusEligible,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
        notes: data.notes,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
      include,
    });
    return (await this.one(row))!;
  }

  async update(id: string, patch: Partial<StaffMemberData> & { updatedById?: string | null }): Promise<StaffMemberRecord> {
    const data: Prisma.StaffMemberUncheckedUpdateInput = {};
    if (patch.displayName !== undefined) data.displayName = patch.displayName;
    if (patch.userId !== undefined) data.userId = patch.userId;
    if (patch.isBonusEligible !== undefined) data.isBonusEligible = patch.isBonusEligible;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.updatedById !== undefined) data.updatedById = patch.updatedById;
    const row = await this.db.staffMember.update({ where: { id }, data, include });
    return (await this.one(row))!;
  }
}
