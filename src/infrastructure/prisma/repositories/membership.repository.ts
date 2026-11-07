import { Prisma } from '@prisma/client';
import { MembershipRecord } from '../../../domain/repositories/records';
import {
  MembershipFilter,
  MembershipPatch,
  MembershipRepository,
  NewMembership,
  PageRequest,
  Paged,
} from '../../../domain/repositories/repositories';
import { PaymentMethod, RecordStatus } from '../../../domain/shared/enums';
import { auditMeta, Db, fromDateOnly, memberRef, memberSelect, num, toDateOnly, userRefs } from '../support';

const include = {
  member: { select: memberSelect },
  plan: { select: { id: true, name: true } },
  cashMovement: { select: { splits: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } },
} satisfies Prisma.MembershipInclude;

type Row = Prisma.MembershipGetPayload<{ include: typeof include }>;

async function toRecords(db: Db, rows: Row[]): Promise<MembershipRecord[]> {
  const users = await userRefs(db, rows.flatMap((r) => [r.createdById, r.updatedById]));
  return rows.map((m) => ({
    id: m.id,
    legacyCode: m.legacyCode,
    memberId: m.memberId,
    member: memberRef(m.member),
    planId: m.planId,
    plan: m.plan ? { id: m.plan.id, name: m.plan.name } : null,
    planName: m.planName,
    startsOn: toDateOnly(m.startsOn),
    expiresOn: toDateOnly(m.expiresOn),
    amountTotal: num(m.amountTotal),
    cashMovementId: m.cashMovementId,
    splits: m.cashMovement.splits.map((s) => ({ method: s.method as PaymentMethod, amount: num(s.amount) })),
    status: m.status as RecordStatus,
    voidedAt: m.voidedAt,
    voidReason: m.voidReason,
    notes: m.notes,
    createdAt: m.createdAt,
    audit: auditMeta(users, m),
  }));
}

/** Mismo `where` para la página y para los totales (HU-REN-04). */
function whereOf(f: MembershipFilter): Prisma.MembershipWhereInput {
  return {
    ...(f.memberId ? { memberId: f.memberId } : {}),
    ...(f.from || f.to
      ? {
          startsOn: {
            ...(f.from ? { gte: fromDateOnly(f.from) } : {}),
            ...(f.to ? { lte: fromDateOnly(f.to) } : {}),
          },
        }
      : {}),
    ...(f.planId ? { planId: f.planId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.method ? { cashMovement: { splits: { some: { method: f.method } } } } : {}),
    member: { deletedAt: null },
  };
}

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<MembershipRecord | null> {
    const row = await this.db.membership.findUnique({ where: { id }, include });
    return row ? (await toRecords(this.db, [row]))[0]! : null;
  }

  async listByMember(memberId: string, includeVoided: boolean): Promise<MembershipRecord[]> {
    const rows = await this.db.membership.findMany({
      where: { memberId, ...(includeVoided ? {} : { status: 'ACTIVE' }) },
      include,
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
    });
    return toRecords(this.db, rows);
  }

  async list(filter: MembershipFilter, page: PageRequest): Promise<Paged<MembershipRecord>> {
    const where = whereOf(filter);
    const [rows, total] = await Promise.all([
      this.db.membership.findMany({
        where,
        include,
        orderBy: [{ startsOn: 'desc' }, { legacyCode: 'desc' }, { createdAt: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.membership.count({ where }),
    ]);
    return { items: await toRecords(this.db, rows), total };
  }

  async totals(filter: MembershipFilter): Promise<{ count: number; amountTotal: number }> {
    const agg = await this.db.membership.aggregate({ where: whereOf(filter), _count: { _all: true }, _sum: { amountTotal: true } });
    return { count: agg._count._all, amountTotal: agg._sum.amountTotal ? num(agg._sum.amountTotal) : 0 };
  }

  async create(data: NewMembership): Promise<MembershipRecord> {
    const row = await this.db.membership.create({
      data: {
        legacyCode: data.legacyCode,
        memberId: data.memberId,
        planId: data.planId,
        planName: data.planName,
        startsOn: fromDateOnly(data.startsOn),
        expiresOn: fromDateOnly(data.expiresOn),
        amountTotal: data.amountTotal,
        cashMovementId: data.cashMovementId,
        notes: data.notes,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
      include,
    });
    return (await toRecords(this.db, [row]))[0]!;
  }

  async update(id: string, patch: MembershipPatch): Promise<MembershipRecord> {
    const data: Prisma.MembershipUncheckedUpdateInput = {};
    if (patch.planId !== undefined) data.planId = patch.planId;
    if (patch.planName !== undefined) data.planName = patch.planName;
    if (patch.startsOn !== undefined) data.startsOn = fromDateOnly(patch.startsOn);
    if (patch.expiresOn !== undefined) data.expiresOn = fromDateOnly(patch.expiresOn);
    if (patch.amountTotal !== undefined) data.amountTotal = patch.amountTotal;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.voidedAt !== undefined) data.voidedAt = patch.voidedAt;
    if (patch.voidedById !== undefined) data.voidedById = patch.voidedById;
    if (patch.voidReason !== undefined) data.voidReason = patch.voidReason;
    if (patch.updatedById !== undefined) data.updatedById = patch.updatedById;
    const row = await this.db.membership.update({ where: { id }, data, include });
    return (await toRecords(this.db, [row]))[0]!;
  }
}
