import { Member, MemberStatusEvent, Plan, Prisma, StaffMember } from '@prisma/client';
import { RenewalWarnDays } from '../../../domain/members/renewal-status';
import { MemberRecord, MemberStatusEventRecord } from '../../../domain/repositories/records';
import {
  CheckInSuggestionRow,
  MemberListQuery,
  MemberPatch,
  MemberRepository,
  MemberSummaryCounts,
  NewMember,
  NutritionQuery,
  NutritionRow,
  Paged,
} from '../../../domain/repositories/repositories';
import { DateOnly } from '../../../domain/shared/date-only';
import { MemberStatus, MemberStatusEventType, NutritionBilling } from '../../../domain/shared/enums';
import {
  auditMeta,
  Db,
  fromDateOnly,
  fromDateOnlyOrNull,
  likePattern,
  orderByIds,
  refOf,
  toDateOnly,
  toDateOnlyOrNull,
  userRefs,
} from '../support';

type MemberWithPlan = Member & {
  currentPlan: Pick<Plan, 'id' | 'name'> | null;
  soldByStaff: Pick<StaffMember, 'id' | 'displayName'> | null;
};

/** Relaciones que necesita `toMemberRecords` (plan actual y 'Vendido por'). */
export const memberInclude = {
  currentPlan: { select: { id: true, name: true } },
  soldByStaff: { select: { id: true, displayName: true } },
} as const;
const include = memberInclude;

export async function toMemberRecords(db: Db, rows: MemberWithPlan[]): Promise<MemberRecord[]> {
  const users = await userRefs(db, rows.flatMap((r) => [r.createdById, r.updatedById]));
  return rows.map((m) => ({
    id: m.id,
    legacyCode: m.legacyCode,
    firstName: m.firstName,
    lastName: m.lastName,
    searchName: m.searchName,
    phoneRaw: m.phoneRaw,
    phoneE164: m.phoneE164,
    phoneNeedsReview: m.phoneNeedsReview,
    email: m.email,
    joinedAt: toDateOnly(m.joinedAt),
    status: m.status as MemberStatus,
    currentPlanId: m.currentPlanId,
    currentPlan: m.currentPlan ? { id: m.currentPlan.id, name: m.currentPlan.name } : null,
    lastRenewalAt: toDateOnlyOrNull(m.lastRenewalAt),
    expiresAt: toDateOnlyOrNull(m.expiresAt),
    cancelledAt: toDateOnlyOrNull(m.cancelledAt),
    cancellationReason: m.cancellationReason,
    acquisitionSource: m.acquisitionSource,
    notes: m.notes,
    soldByStaffId: m.soldByStaffId,
    soldBy: m.soldByStaff ? { id: m.soldByStaff.id, displayName: m.soldByStaff.displayName } : null,
    deletedAt: m.deletedAt,
    audit: auditMeta(users, m),
  }));
}

/** Estado de cuota en SQL (misma regla que domain/members/renewal-status.ts) para filtrar y ordenar. */
export function renewalStatusSql(today: DateOnly, warn: RenewalWarnDays, alias = 'm'): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`(CASE
    WHEN ${a}.status::text = 'CANCELLED' THEN 'CANCELLED'
    WHEN ${a}.expires_at IS NULL THEN 'UNKNOWN'
    WHEN ${a}.expires_at < ${today}::date THEN 'EXPIRED'
    WHEN ${a}.expires_at = ${today}::date THEN 'DUE_TODAY'
    WHEN ${a}.expires_at <= ${today}::date + ${warn.due3d}::int THEN 'DUE_3D'
    WHEN ${a}.expires_at <= ${today}::date + ${warn.due7d}::int THEN 'DUE_7D'
    ELSE 'OK' END)`;
}

export class PrismaMemberRepository implements MemberRepository {
  constructor(private readonly db: Db) {}

  private async fetch(ids: string[]): Promise<MemberRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.member.findMany({ where: { id: { in: ids } }, include });
    return orderByIds(ids, await toMemberRecords(this.db, rows));
  }

  async findById(id: string): Promise<MemberRecord | null> {
    const row = await this.db.member.findUnique({ where: { id }, include });
    return row ? (await toMemberRecords(this.db, [row]))[0]! : null;
  }

  async findActiveBySearchName(searchName: string, excludeId?: string): Promise<{ id: string; legacyCode: string } | null> {
    return this.db.member.findFirst({
      where: { searchName, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, legacyCode: true },
    });
  }

  async create(data: NewMember): Promise<MemberRecord> {
    const row = await this.db.member.create({
      data: {
        legacyCode: data.legacyCode,
        firstName: data.firstName,
        lastName: data.lastName,
        searchName: data.searchName,
        phoneRaw: data.phoneRaw,
        phoneE164: data.phoneE164,
        phoneNeedsReview: data.phoneNeedsReview,
        email: data.email,
        joinedAt: fromDateOnly(data.joinedAt),
        status: data.status,
        currentPlanId: data.currentPlanId,
        acquisitionSource: data.acquisitionSource,
        notes: data.notes,
        soldByStaffId: data.soldByStaffId,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
      include,
    });
    return (await toMemberRecords(this.db, [row]))[0]!;
  }

  async update(id: string, patch: MemberPatch): Promise<MemberRecord> {
    const data: Prisma.MemberUncheckedUpdateInput = {};
    if (patch.firstName !== undefined) data.firstName = patch.firstName;
    if (patch.lastName !== undefined) data.lastName = patch.lastName;
    if (patch.searchName !== undefined) data.searchName = patch.searchName;
    if (patch.phoneRaw !== undefined) data.phoneRaw = patch.phoneRaw;
    if (patch.phoneE164 !== undefined) data.phoneE164 = patch.phoneE164;
    if (patch.phoneNeedsReview !== undefined) data.phoneNeedsReview = patch.phoneNeedsReview;
    if (patch.email !== undefined) data.email = patch.email;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.currentPlanId !== undefined) data.currentPlanId = patch.currentPlanId;
    if (patch.lastRenewalAt !== undefined) data.lastRenewalAt = fromDateOnlyOrNull(patch.lastRenewalAt);
    if (patch.expiresAt !== undefined) data.expiresAt = fromDateOnlyOrNull(patch.expiresAt);
    if (patch.cancelledAt !== undefined) data.cancelledAt = fromDateOnlyOrNull(patch.cancelledAt);
    if (patch.cancellationReason !== undefined) data.cancellationReason = patch.cancellationReason;
    if (patch.acquisitionSource !== undefined) data.acquisitionSource = patch.acquisitionSource;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.soldByStaffId !== undefined) data.soldByStaffId = patch.soldByStaffId;
    if (patch.deletedAt !== undefined) data.deletedAt = patch.deletedAt;
    if (patch.updatedById !== undefined) data.updatedById = patch.updatedById;
    const row = await this.db.member.update({ where: { id }, data, include });
    return (await toMemberRecords(this.db, [row]))[0]!;
  }

  async list(q: MemberListQuery): Promise<Paged<MemberRecord>> {
    const rs = renewalStatusSql(q.today, q.warnDays);
    const conditions: Prisma.Sql[] = [Prisma.sql`m.deleted_at IS NULL`, Prisma.sql`m.status::text = ${q.status}`];
    if (q.q) {
      const p = likePattern(q.q);
      conditions.push(Prisma.sql`(m.search_name LIKE ${p} OR lower(m.legacy_code) LIKE ${p})`);
    }
    if (q.renewalStatus) conditions.push(Prisma.sql`${rs} IN (${Prisma.join(q.renewalStatus)})`);
    if (q.planId) conditions.push(Prisma.sql`m.current_plan_id = ${q.planId}::uuid`);
    if (q.renewedFrom) conditions.push(Prisma.sql`m.last_renewal_at >= ${q.renewedFrom}::date`);
    if (q.renewedTo) conditions.push(Prisma.sql`m.last_renewal_at <= ${q.renewedTo}::date`);
    const where = Prisma.join(conditions, ' AND ');
    const dir = Prisma.raw(q.order === 'desc' ? 'DESC' : 'ASC');
    const priority = Prisma.sql`(CASE ${rs} WHEN 'EXPIRED' THEN 0 WHEN 'DUE_TODAY' THEN 1 WHEN 'DUE_3D' THEN 2
      WHEN 'DUE_7D' THEN 3 WHEN 'OK' THEN 4 WHEN 'UNKNOWN' THEN 5 ELSE 6 END)`;
    const orderBy: Record<MemberListQuery['sort'], Prisma.Sql> = {
      priority: Prisma.sql`${priority} ${dir}, m.last_name ASC, m.first_name ASC`,
      lastName: Prisma.sql`m.last_name ${dir}, m.first_name ${dir}`,
      expiresAt: Prisma.sql`m.expires_at ${dir} NULLS LAST, m.last_name ASC, m.first_name ASC`,
      lastRenewalAt: Prisma.sql`m.last_renewal_at ${dir} NULLS LAST, m.last_name ASC, m.first_name ASC`,
      joinedAt: Prisma.sql`m.joined_at ${dir}, m.last_name ASC, m.first_name ASC`,
    };
    const offset = (q.page.page - 1) * q.page.pageSize;
    const [idRows, countRows] = await Promise.all([
      this.db.$queryRaw<{ id: string }[]>`SELECT m.id::text AS id FROM members m WHERE ${where}
        ORDER BY ${orderBy[q.sort]}, m.id ASC LIMIT ${q.page.pageSize} OFFSET ${offset}`,
      this.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM members m WHERE ${where}`,
    ]);
    return { items: await this.fetch(idRows.map((r) => r.id)), total: countRows[0]?.n ?? 0 };
  }

  async summary(today: DateOnly, warn: RenewalWarnDays): Promise<MemberSummaryCounts> {
    const rs = renewalStatusSql(today, warn);
    const rows = await this.db.$queryRaw<
      {
        registered: number;
        active_up_to_date: number;
        expired: number;
        due_today: number;
        due3d: number;
        due7d: number;
        ok: number;
        unknown: number;
        cancelled: number;
      }[]
    >`SELECT
        count(*)::int AS registered,
        count(*) FILTER (WHERE ${rs} IN ('OK','DUE_7D','DUE_3D','DUE_TODAY'))::int AS active_up_to_date,
        count(*) FILTER (WHERE ${rs} = 'EXPIRED')::int AS expired,
        count(*) FILTER (WHERE ${rs} = 'DUE_TODAY')::int AS due_today,
        count(*) FILTER (WHERE ${rs} = 'DUE_3D')::int AS due3d,
        count(*) FILTER (WHERE ${rs} = 'DUE_7D')::int AS due7d,
        count(*) FILTER (WHERE ${rs} = 'OK')::int AS ok,
        count(*) FILTER (WHERE ${rs} = 'UNKNOWN')::int AS unknown,
        count(*) FILTER (WHERE ${rs} = 'CANCELLED')::int AS cancelled
      FROM members m WHERE m.deleted_at IS NULL`;
    const r = rows[0]!;
    return {
      registered: r.registered,
      activeUpToDate: r.active_up_to_date,
      expired: r.expired,
      dueToday: r.due_today,
      due3d: r.due3d,
      due7d: r.due7d,
      ok: r.ok,
      unknown: r.unknown,
      cancelled: r.cancelled,
    };
  }

  async searchForCheckIn(q: string, limit: number, today: DateOnly): Promise<CheckInSuggestionRow[]> {
    const p = likePattern(q);
    const starts = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const idRows = await this.db.$queryRaw<{ id: string }[]>`SELECT m.id::text AS id FROM members m
      WHERE m.deleted_at IS NULL AND m.status::text <> 'CANCELLED'
        AND (m.search_name LIKE ${p} OR lower(m.legacy_code) LIKE ${p})
      ORDER BY (CASE WHEN m.search_name LIKE ${starts} OR lower(m.legacy_code) LIKE ${starts} THEN 0 ELSE 1 END),
        m.last_name ASC, m.first_name ASC
      LIMIT ${limit}`;
    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return [];
    const [members, todays] = await Promise.all([
      this.db.member.findMany({ where: { id: { in: ids } }, include }),
      this.db.attendance.groupBy({
        by: ['memberId'],
        where: { memberId: { in: ids }, status: 'ACTIVE', checkedInOn: fromDateOnly(today) },
        _max: { checkedInAt: true },
      }),
    ]);
    const lastToday = new Map(todays.map((t) => [t.memberId, t._max.checkedInAt]));
    return orderByIds(ids, members).map((m) => ({
      id: m.id,
      legacyCode: m.legacyCode,
      firstName: m.firstName,
      lastName: m.lastName,
      status: m.status as MemberStatus,
      expiresAt: toDateOnlyOrNull(m.expiresAt),
      planName: m.currentPlan?.name ?? null,
      lastCheckInToday: lastToday.get(m.id) ?? null,
    }));
  }

  async findAutoCancelCandidates(expiresBefore: DateOnly): Promise<MemberRecord[]> {
    const rows = await this.db.member.findMany({
      where: { status: 'ACTIVE', deletedAt: null, expiresAt: { lt: fromDateOnly(expiresBefore) } },
      include,
      orderBy: [{ expiresAt: 'asc' }, { lastName: 'asc' }],
    });
    return toMemberRecords(this.db, rows);
  }

  async hasActivity(id: string): Promise<boolean> {
    const [movements, memberships, attendances] = await Promise.all([
      this.db.cashMovement.count({ where: { memberId: id, status: 'ACTIVE' } }),
      this.db.membership.count({ where: { memberId: id, status: 'ACTIVE' } }),
      this.db.attendance.count({ where: { memberId: id, status: 'ACTIVE' } }),
    ]);
    return movements + memberships + attendances > 0;
  }

  private async toEvents(rows: MemberStatusEvent[]): Promise<MemberStatusEventRecord[]> {
    const users = await userRefs(this.db, rows.map((r) => r.createdById));
    return rows.map((e) => ({
      id: e.id,
      memberId: e.memberId,
      type: e.type as MemberStatusEventType,
      effectiveOn: toDateOnly(e.effectiveOn),
      reason: e.reason,
      createdBy: refOf(users, e.createdById),
      createdAt: e.createdAt,
    }));
  }

  async addStatusEvent(data: {
    memberId: string;
    type: MemberStatusEventType;
    effectiveOn: DateOnly;
    reason: string | null;
    createdById: string | null;
  }): Promise<MemberStatusEventRecord> {
    const row = await this.db.memberStatusEvent.create({
      data: { ...data, effectiveOn: fromDateOnly(data.effectiveOn) },
    });
    return (await this.toEvents([row]))[0]!;
  }

  async listStatusEvents(memberId: string): Promise<MemberStatusEventRecord[]> {
    const rows = await this.db.memberStatusEvent.findMany({
      where: { memberId },
      orderBy: [{ effectiveOn: 'asc' }, { createdAt: 'asc' }],
    });
    return this.toEvents(rows);
  }

  async lastCancellationEvent(memberId: string): Promise<MemberStatusEventRecord | null> {
    const row = await this.db.memberStatusEvent.findFirst({
      where: { memberId, type: { in: ['CANCELLED', 'AUTO_CANCELLED'] } },
      orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
    });
    return row ? (await this.toEvents([row]))[0]! : null;
  }

  async listNutrition(query: NutritionQuery): Promise<Paged<NutritionRow>> {
    const conditions: Prisma.Sql[] = [Prisma.sql`m.deleted_at IS NULL`, Prisma.sql`m.status::text = ${query.status}`];
    if (query.q) {
      const p = likePattern(query.q);
      conditions.push(Prisma.sql`(m.search_name LIKE ${p} OR lower(m.legacy_code) LIKE ${p})`);
    }
    if (query.nutritionBilling) {
      conditions.push(Prisma.sql`coalesce(cp.nutrition_billing, mp.nutrition_billing)::text = ${query.nutritionBilling}`);
    }
    const where = Prisma.join(conditions, ' AND ');
    // Membresía vigente = la ACTIVE más reciente que cubre hoy.
    const from = Prisma.sql`FROM members m
      LEFT JOIN LATERAL (
        SELECT ms.plan_id, ms.starts_on, ms.expires_on FROM memberships ms
        WHERE ms.member_id = m.id AND ms.status::text = 'ACTIVE'
          AND ms.starts_on <= ${query.today}::date AND ms.expires_on >= ${query.today}::date
          AND ms.plan_id IS NOT NULL
        ORDER BY ms.starts_on DESC, ms.created_at DESC LIMIT 1
      ) cm ON true
      LEFT JOIN plans cp ON cp.id = cm.plan_id
      LEFT JOIN plans mp ON mp.id = m.current_plan_id`;
    const offset = (query.page.page - 1) * query.page.pageSize;
    const [rows, countRows] = await Promise.all([
      this.db.$queryRaw<
        {
          id: string;
          legacy_code: string;
          first_name: string;
          last_name: string;
          status: string;
          expires_at: Date | null;
          cm_starts_on: Date | null;
          cm_expires_on: Date | null;
          cp_id: string | null;
          cp_name: string | null;
          cp_billing: string | null;
          mp_id: string | null;
          mp_name: string | null;
          mp_billing: string | null;
        }[]
      >`SELECT m.id::text AS id, m.legacy_code, m.first_name, m.last_name, m.status::text AS status, m.expires_at,
          cm.starts_on AS cm_starts_on, cm.expires_on AS cm_expires_on,
          cp.id::text AS cp_id, cp.name AS cp_name, cp.nutrition_billing::text AS cp_billing,
          mp.id::text AS mp_id, mp.name AS mp_name, mp.nutrition_billing::text AS mp_billing
        ${from} WHERE ${where}
        ORDER BY m.last_name ASC, m.first_name ASC, m.id ASC
        LIMIT ${query.page.pageSize} OFFSET ${offset}`,
      this.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${from} WHERE ${where}`,
    ]);
    return {
      total: countRows[0]?.n ?? 0,
      items: rows.map((r) => {
        const fromMembership = r.cp_id !== null;
        const planId = fromMembership ? r.cp_id : r.mp_id;
        return {
          id: r.id,
          legacyCode: r.legacy_code,
          firstName: r.first_name,
          lastName: r.last_name,
          status: r.status as MemberStatus,
          expiresAt: toDateOnlyOrNull(r.expires_at),
          plan: planId
            ? {
                id: planId,
                name: (fromMembership ? r.cp_name : r.mp_name) ?? '',
                nutritionBilling: ((fromMembership ? r.cp_billing : r.mp_billing) ?? 'NUTRITIONIST') as NutritionBilling,
              }
            : null,
          planSource: fromMembership ? 'CURRENT_MEMBERSHIP' : planId ? 'MEMBER_PLAN' : 'NONE',
          membershipStartsOn: fromMembership ? toDateOnlyOrNull(r.cm_starts_on) : null,
          membershipExpiresOn: fromMembership ? toDateOnlyOrNull(r.cm_expires_on) : null,
        };
      }),
    };
  }
}
