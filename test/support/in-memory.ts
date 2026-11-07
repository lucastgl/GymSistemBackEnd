/* Repositorios en memoria para probar casos de uso sin base de datos. */
import { randomUUID } from 'node:crypto';
import { AuditRecord } from '../../src/domain/audit/audit-entry';
import { AccessTokenClaims, Clock, PasswordHasher, SecretGenerator, TokenService } from '../../src/domain/ports/ports';
import {
  ExclusiveResult,
  RepositoryAuditLogger,
  TransactionContext,
  UnitOfWork,
} from '../../src/domain/ports/unit-of-work';
import {
  AttendanceRecord,
  CashMovementRecord,
  CashMovementRowRecord,
  CashTotalsRecord,
  CategoryRecord,
  IncentivePeriodRecord,
  JobRunRecord,
  LeadRecord,
  MemberRecord,
  MemberStatusEventRecord,
  MembershipRecord,
  MetricSnapshotRecord,
  MetricValueRecord,
  PlanRecord,
  RefreshTokenRecord,
  SettingRecord,
  SplitRecord,
  StaffMemberRecord,
  UserRecord,
} from '../../src/domain/repositories/records';
import {
  AttendanceFilter,
  CashFilter,
  IncentiveMonthlyFactsRecord,
  MembershipFilter,
  PageRequest,
  Paged,
  Repositories,
} from '../../src/domain/repositories/repositories';
import { MemberStatusEventType } from '../../src/domain/shared/enums';
import { DateOnly } from '../../src/domain/shared/date-only';
import { Period } from '../../src/domain/shared/period';
import { fullName } from '../../src/domain/shared/text';

const notImplemented = (name: string) => (): never => {
  throw new Error(`InMemory: ${name} no implementado`);
};

export interface MembershipRow {
  id: string;
  legacyCode: string | null;
  memberId: string;
  planId: string | null;
  planName: string;
  startsOn: DateOnly;
  expiresOn: DateOnly;
  amountTotal: number;
  cashMovementId: string;
  status: 'ACTIVE' | 'VOIDED';
  voidedAt: Date | null;
  voidReason: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashRow {
  id: string;
  legacyCode: string | null;
  occurredOn: DateOnly;
  type: 'INCOME' | 'EXPENSE';
  categoryId: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
  memberId: string | null;
  origin: 'MANUAL' | 'RENEWAL' | 'IMPORT';
  status: 'ACTIVE' | 'VOIDED';
  voidedAt: Date | null;
  voidReason: string | null;
  splits: SplitRecord[];
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttendanceRow {
  id: string;
  memberId: string;
  checkedInAt: Date;
  checkedInOn: DateOnly;
  source: 'WEB' | 'MANUAL';
  notes: string | null;
  status: 'ACTIVE' | 'VOIDED';
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type StoredIncentivePeriod = Omit<IncentivePeriodRecord, 'publishedBy' | 'closedBy'> & {
  publishedById: string | null;
  closedById: string | null;
};

/** Estado completo de la "base" en memoria (se clona para el rollback). */
export class InMemoryDb {
  users: UserRecord[] = [];
  refreshTokens: RefreshTokenRecord[] = [];
  plans: PlanRecord[] = [];
  categories: CategoryRecord[] = [];
  members: MemberRecord[] = [];
  events: MemberStatusEventRecord[] = [];
  memberships: MembershipRow[] = [];
  cash: CashRow[] = [];
  attendances: AttendanceRow[] = [];
  leads: LeadRecord[] = [];
  settings: SettingRecord[] = [];
  audit: AuditRecord[] = [];
  jobRuns: JobRunRecord[] = [];
  snapshots: (MetricSnapshotRecord & { values: MetricValueRecord[] })[] = [];
  staff: StaffMemberRecord[] = [];
  incentivePeriods: StoredIncentivePeriod[] = [];
  seq = { member: 190, membership: 503, movement: 84, lead: 87 };

  snapshot(): string {
    // `toJSON` de Date corre antes del replacer: se mira el valor original en `this[key]`.
    return JSON.stringify(this, function (this: Record<string, unknown>, key: string, v: unknown) {
      const raw = this[key];
      return raw instanceof Date ? { __date: raw.toISOString() } : v;
    });
  }

  restore(json: string): void {
    const data = JSON.parse(json, (_k, v: unknown) =>
      v && typeof v === 'object' && '__date' in (v as Record<string, unknown>) ? new Date((v as { __date: string }).__date) : v,
    ) as InMemoryDb;
    Object.assign(this, data);
  }
}

const meta = (createdAt: Date, updatedAt: Date) => ({ createdAt, createdBy: null, updatedAt, updatedBy: null });

export function inMemoryRepositories(db: InMemoryDb, clock: Clock): Repositories {
  const memberRef = (id: string) => {
    const m = db.members.find((x) => x.id === id)!;
    return { id: m.id, legacyCode: m.legacyCode, fullName: fullName(m.firstName, m.lastName) };
  };
  const toMembership = (r: MembershipRow): MembershipRecord => {
    const plan = r.planId ? db.plans.find((p) => p.id === r.planId) : undefined;
    const cash = db.cash.find((c) => c.id === r.cashMovementId);
    return {
      ...r,
      member: memberRef(r.memberId),
      plan: plan ? { id: plan.id, name: plan.name } : null,
      splits: cash ? cash.splits.map((s) => ({ ...s })) : [],
      audit: meta(r.createdAt, r.updatedAt),
    };
  };
  const toCash = (r: CashRow): CashMovementRecord => ({
    id: r.id,
    legacyCode: r.legacyCode,
    occurredOn: r.occurredOn,
    type: r.type,
    category: db.categories.find((c) => c.id === r.categoryId)!,
    subcategory: r.subcategory,
    amount: r.amount,
    splits: r.splits.map((s) => ({ ...s })),
    description: r.description,
    memberId: r.memberId,
    member: r.memberId ? memberRef(r.memberId) : null,
    origin: r.origin,
    membershipId: db.memberships.find((m) => m.cashMovementId === r.id)?.id ?? null,
    status: r.status,
    voidedAt: r.voidedAt,
    voidReason: r.voidReason,
    audit: meta(r.createdAt, r.updatedAt),
  });
  const toAttendance = (r: AttendanceRow): AttendanceRecord => ({
    ...r,
    member: memberRef(r.memberId),
    audit: meta(r.createdAt, r.updatedAt),
  });
  const page = <T>(items: T[], p: PageRequest): Paged<T> => ({
    items: items.slice((p.page - 1) * p.pageSize, p.page * p.pageSize),
    total: items.length,
  });
  const cashMatches = (f: CashFilter) => (r: CashRow) =>
    r.occurredOn >= f.from &&
    r.occurredOn <= f.to &&
    r.status === f.status &&
    (!f.type || r.type === f.type) &&
    (!f.categoryId || r.categoryId === f.categoryId) &&
    (!f.origin || r.origin === f.origin) &&
    (!f.memberId || r.memberId === f.memberId) &&
    (!f.createdBy || r.createdById === f.createdBy) &&
    (!f.method || r.splits.some((s) => s.method === f.method));
  const membershipMatches = (f: MembershipFilter) => (r: MembershipRow) =>
    (!f.memberId || r.memberId === f.memberId) &&
    (!f.from || r.startsOn >= f.from) &&
    (!f.to || r.startsOn <= f.to) &&
    (!f.planId || r.planId === f.planId) &&
    (!f.status || r.status === f.status);
  const attendanceMatches = (f: AttendanceFilter) => (r: AttendanceRow) =>
    (!f.memberId || r.memberId === f.memberId) &&
    (!f.status || r.status === f.status) &&
    (!f.from || r.checkedInOn >= f.from) &&
    (!f.to || r.checkedInOn <= f.to);
  const withPlan = (m: MemberRecord): MemberRecord => {
    const plan = m.currentPlanId ? db.plans.find((p) => p.id === m.currentPlanId) : undefined;
    const soldBy = m.soldByStaffId ? db.staff.find((x) => x.id === m.soldByStaffId) : undefined;
    return {
      ...m,
      currentPlan: plan ? { id: plan.id, name: plan.name } : null,
      soldBy: soldBy ? { id: soldBy.id, displayName: soldBy.displayName } : null,
    };
  };
  const userRef = (id: string | null) => {
    const u = id ? db.users.find((x) => x.id === id) : undefined;
    return u ? { id: u.id, fullName: u.fullName } : null;
  };
  const toStaff = (s: StaffMemberRecord): StaffMemberRecord => ({ ...s, user: userRef(s.userId) });
  const toIncentive = (r: StoredIncentivePeriod): IncentivePeriodRecord => {
    const { publishedById, closedById, ...rest } = r;
    return { ...rest, publishedBy: userRef(publishedById), closedBy: userRef(closedById) };
  };
  const liveMember = (id: string) => db.members.find((m) => m.id === id && !m.deletedAt);
  /** Altas con cobro: primera membresía ACTIVE (starts_on, created_at, id) de socios con joined_at ≥ since. */
  const firstPayments = (since: DateOnly) => {
    const byMember = new Map<string, MembershipRow[]>();
    for (const m of db.memberships.filter((x) => x.status === 'ACTIVE')) {
      const list = byMember.get(m.memberId) ?? [];
      list.push(m);
      byMember.set(m.memberId, list);
    }
    const out: { membership: MembershipRow; member: MemberRecord }[] = [];
    for (const [memberId, list] of byMember) {
      const member = liveMember(memberId);
      if (!member || member.joinedAt < since) continue;
      const first = [...list].sort(
        (a, b) =>
          a.startsOn.localeCompare(b.startsOn) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
      )[0]!;
      out.push({ membership: first, member });
    }
    return out;
  };

  return {
    users: {
      findById: async (id) => db.users.find((u) => u.id === id) ?? null,
      findByEmail: async (email) => db.users.find((u) => u.email === email) ?? null,
      list: async (f, p) => page(db.users.filter((u) => (!f.role || u.role === f.role) && (f.isActive === undefined || u.isActive === f.isActive)), p),
      create: async (data) => {
        const now = clock.now();
        const u: UserRecord = { id: randomUUID(), ...data, isActive: true, lastLoginAt: null, createdAt: now, updatedAt: now };
        db.users.push(u);
        return u;
      },
      update: async (id, patch) => {
        const u = db.users.find((x) => x.id === id)!;
        Object.assign(u, patch, { updatedAt: clock.now() });
        return { ...u };
      },
      countActiveAdmins: async () => db.users.filter((u) => u.role === 'ADMIN' && u.isActive).length,
    },
    refreshTokens: {
      create: async (data) => {
        const t: RefreshTokenRecord = { id: randomUUID(), userId: data.userId, tokenHash: data.tokenHash, familyId: data.familyId, expiresAt: data.expiresAt, revokedAt: null, createdAt: clock.now() };
        db.refreshTokens.push(t);
        return t;
      },
      findByHash: async (h) => db.refreshTokens.find((t) => t.tokenHash === h) ?? null,
      revokeIfActive: async (id, at) => {
        const t = db.refreshTokens.find((x) => x.id === id);
        if (!t || t.revokedAt) return false;
        t.revokedAt = at;
        return true;
      },
      revokeFamily: async (familyId, at) => {
        const list = db.refreshTokens.filter((t) => t.familyId === familyId && !t.revokedAt);
        list.forEach((t) => (t.revokedAt = at));
        return list.length;
      },
      revokeAllForUser: async (userId, at) => {
        const list = db.refreshTokens.filter((t) => t.userId === userId && !t.revokedAt);
        list.forEach((t) => (t.revokedAt = at));
        return list.length;
      },
    },
    plans: {
      list: async (inc) => db.plans.filter((p) => inc || p.isActive),
      findById: async (id) => db.plans.find((p) => p.id === id) ?? null,
      findByCode: async (code) => db.plans.find((p) => p.code === code) ?? null,
      findByName: async (name) => db.plans.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null,
      create: notImplemented('plans.create'),
      update: notImplemented('plans.update'),
    },
    categories: {
      list: async (f) => db.categories.filter((c) => (!f.type || c.type === f.type) && (f.includeInactive || c.isActive)),
      findById: async (id) => db.categories.find((c) => c.id === id) ?? null,
      findByTypeAndName: async (type, name) => db.categories.find((c) => c.type === type && c.name === name) ?? null,
      findRenewalCategory: async () => db.categories.find((c) => c.isSystem && c.type === 'INCOME') ?? null,
      create: notImplemented('categories.create'),
      update: notImplemented('categories.update'),
      countMovements: async (id) => db.cash.filter((c) => c.categoryId === id).length,
    },
    members: {
      findById: async (id) => {
        const m = db.members.find((x) => x.id === id);
        return m ? withPlan({ ...m }) : null;
      },
      findActiveBySearchName: async (s, exclude) => {
        const m = db.members.find((x) => x.searchName === s && !x.deletedAt && x.id !== exclude);
        return m ? { id: m.id, legacyCode: m.legacyCode } : null;
      },
      create: async (data) => {
        const now = clock.now();
        const m: MemberRecord = {
          id: randomUUID(),
          ...data,
          currentPlan: null,
          lastRenewalAt: null,
          expiresAt: null,
          cancelledAt: null,
          cancellationReason: null,
          soldBy: null,
          deletedAt: null,
          audit: meta(now, now),
        };
        delete (m as unknown as Record<string, unknown>).createdById;
        db.members.push(m);
        return withPlan({ ...m });
      },
      update: async (id, patch) => {
        const m = db.members.find((x) => x.id === id)!;
        const { updatedById: _u, ...rest } = patch;
        Object.assign(m, rest);
        m.audit = { ...m.audit, updatedAt: clock.now() };
        return withPlan({ ...m });
      },
      list: notImplemented('members.list'),
      summary: notImplemented('members.summary'),
      searchForCheckIn: notImplemented('members.searchForCheckIn'),
      findAutoCancelCandidates: async (before) =>
        db.members.filter((m) => m.status === 'ACTIVE' && !m.deletedAt && m.expiresAt !== null && m.expiresAt < before).map((m) => withPlan({ ...m })),
      hasActivity: async (id) =>
        db.cash.some((c) => c.memberId === id && c.status === 'ACTIVE') ||
        db.memberships.some((c) => c.memberId === id && c.status === 'ACTIVE') ||
        db.attendances.some((c) => c.memberId === id && c.status === 'ACTIVE'),
      addStatusEvent: async (data) => {
        const e: MemberStatusEventRecord = { id: randomUUID(), memberId: data.memberId, type: data.type, effectiveOn: data.effectiveOn, reason: data.reason, createdBy: null, createdAt: clock.now() };
        db.events.push(e);
        return e;
      },
      listStatusEvents: async (memberId) => db.events.filter((e) => e.memberId === memberId),
      lastCancellationEvent: async (memberId) =>
        [...db.events].reverse().find((e) => e.memberId === memberId && (e.type === 'CANCELLED' || e.type === 'AUTO_CANCELLED')) ?? null,
      listNutrition: notImplemented('members.listNutrition'),
    },
    memberships: {
      findById: async (id) => {
        const r = db.memberships.find((m) => m.id === id);
        return r ? toMembership(r) : null;
      },
      listByMember: async (memberId, includeVoided) =>
        db.memberships
          .filter((m) => m.memberId === memberId && (includeVoided || m.status === 'ACTIVE'))
          .sort((a, b) => (a.startsOn === b.startsOn ? b.createdAt.getTime() - a.createdAt.getTime() : a.startsOn < b.startsOn ? 1 : -1))
          .map(toMembership),
      list: async (f, p) => page(db.memberships.filter(membershipMatches(f)).map(toMembership), p),
      totals: async (f) => {
        const rows = db.memberships.filter(membershipMatches(f));
        return { count: rows.length, amountTotal: rows.reduce((a, r) => a + r.amountTotal, 0) };
      },
      create: async (data) => {
        const now = clock.now();
        const r: MembershipRow = { id: randomUUID(), ...data, status: 'ACTIVE', voidedAt: null, voidReason: null, createdAt: now, updatedAt: now };
        delete (r as unknown as Record<string, unknown>).createdById;
        db.memberships.push(r);
        return toMembership(r);
      },
      update: async (id, patch) => {
        const r = db.memberships.find((m) => m.id === id)!;
        const { updatedById: _u, voidedById: _v, ...rest } = patch;
        Object.assign(r, rest, { updatedAt: clock.now() });
        return toMembership(r);
      },
    },
    cash: {
      findById: async (id) => {
        const r = db.cash.find((c) => c.id === id);
        return r ? toCash(r) : null;
      },
      create: async (data) => {
        const now = clock.now();
        const r: CashRow = { id: randomUUID(), ...data, splits: data.splits.map((s) => ({ ...s })), status: 'ACTIVE', voidedAt: null, voidReason: null, createdAt: now, updatedAt: now };
        db.cash.push(r);
        return toCash(r);
      },
      update: async (id, patch) => {
        const r = db.cash.find((c) => c.id === id)!;
        const { updatedById: _u, voidedById: _v, splits, ...rest } = patch;
        Object.assign(r, rest, { updatedAt: clock.now() });
        if (splits) r.splits = splits.map((s) => ({ ...s }));
        return toCash(r);
      },
      list: async (f, p, expand): Promise<Paged<CashMovementRowRecord>> => {
        const rows = db.cash.filter(cashMatches(f)).map(toCash);
        const out: CashMovementRowRecord[] = expand
          ? rows.flatMap((r) => r.splits.map((s, i) => ({ ...r, splitIndex: r.splits.length > 1 ? i + 1 : null, method: s.method, rowAmount: s.amount })))
          : rows.map((r) => ({ ...r, splitIndex: null, method: r.splits.length === 1 ? r.splits[0]!.method : null, rowAmount: r.amount }));
        return page(out, p);
      },
      totals: async (f): Promise<CashTotalsRecord> => {
        const rows = db.cash.filter(cashMatches(f));
        const sum = (type: string) => rows.filter((r) => r.type === type).reduce((a, r) => a + r.amount, 0);
        return {
          income: sum('INCOME'),
          expense: sum('EXPENSE'),
          count: rows.length,
          renewalCount: rows.filter((r) => r.origin === 'RENEWAL').length,
          incomeByMethod: {},
          expenseByMethod: {},
          incomeByCategory: {},
          expenseByCategory: {},
        };
      },
    },
    attendances: {
      findById: async (id) => {
        const r = db.attendances.find((a) => a.id === id);
        return r ? toAttendance(r) : null;
      },
      create: async (data) => {
        const now = clock.now();
        const r: AttendanceRow = { id: randomUUID(), memberId: data.memberId, checkedInAt: data.checkedInAt, checkedInOn: data.checkedInOn, source: data.source, notes: data.notes, status: 'ACTIVE', voidedAt: null, voidReason: null, createdAt: now, updatedAt: now };
        db.attendances.push(r);
        return toAttendance(r);
      },
      update: async (id, patch) => {
        const r = db.attendances.find((a) => a.id === id)!;
        const { updatedById: _u, voidedById: _v, ...rest } = patch;
        Object.assign(r, rest, { updatedAt: clock.now() });
        return toAttendance(r);
      },
      findActiveOnDate: async (memberId, date, exclude) => {
        const r = db.attendances.find((a) => a.memberId === memberId && a.checkedInOn === date && a.status === 'ACTIVE' && a.id !== exclude);
        return r ? toAttendance(r) : null;
      },
      list: async (f, p) => page(db.attendances.filter(attendanceMatches(f)).map(toAttendance), p),
      totals: async (f) => {
        const rows = db.attendances.filter(attendanceMatches(f));
        return { count: rows.length, distinctMembers: new Set(rows.map((r) => r.memberId)).size };
      },
      lastActive: async (memberId) => {
        const rows = db.attendances.filter((a) => a.memberId === memberId && a.status === 'ACTIVE').sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime());
        return rows[0] ? { checkedInAt: rows[0].checkedInAt, checkedInOn: rows[0].checkedInOn } : null;
      },
      riskList: notImplemented('attendances.riskList'),
      riskSummary: notImplemented('attendances.riskSummary'),
      countOnDate: async (date) => db.attendances.filter((a) => a.checkedInOn === date && a.status === 'ACTIVE').length,
    },
    leads: {
      list: async () => db.leads,
      listContactedBetween: async (from, to) => db.leads.filter((l) => !l.deletedAt && l.contactedOn >= from && l.contactedOn <= to),
      findById: async (id) => db.leads.find((l) => l.id === id) ?? null,
      create: notImplemented('leads.create'),
      update: notImplemented('leads.update'),
    },
    settings: {
      getAll: async () => db.settings,
      upsert: notImplemented('settings.upsert'),
    },
    metrics: {
      loadDataset: async (period, graceDays) => {
        const ini = Period.first(period);
        const fin = Period.last(period);
        const finPlusGrace = DateOnly.addDays(fin, graceDays);
        const live = db.members.filter((m) => !m.deletedAt);
        const liveIds = new Set(live.map((m) => m.id));
        return {
          period,
          members: live.map((m) => ({
            id: m.id,
            joinedAt: m.joinedAt,
            hasMemberships: db.memberships.some((x) => x.memberId === m.id),
            lastRenewalAt: m.lastRenewalAt,
            expiresAt: m.expiresAt,
          })),
          statusEvents: db.events
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => e.effectiveOn <= fin && liveIds.has(e.memberId))
            .sort((a, b) => a.e.effectiveOn.localeCompare(b.e.effectiveOn) || a.i - b.i)
            .map(({ e }, seq) => ({ memberId: e.memberId, type: e.type as MemberStatusEventType, effectiveOn: e.effectiveOn, seq })),
          memberships: db.memberships
            .filter((m) => m.status === 'ACTIVE' && m.startsOn <= finPlusGrace && liveIds.has(m.memberId))
            .map((m) => ({ id: m.id, memberId: m.memberId, startsOn: m.startsOn, expiresOn: m.expiresOn })),
          movements: db.cash
            .filter((c) => c.status === 'ACTIVE' && c.occurredOn >= ini && c.occurredOn <= fin)
            .map((c) => ({
              type: c.type,
              origin: c.origin,
              amount: c.amount,
              categoryName: db.categories.find((x) => x.id === c.categoryId)?.name ?? '',
              splits: c.splits.map((sp) => ({ method: sp.method, amount: sp.amount })),
            })),
          attendances: db.attendances
            .filter((a) => a.status === 'ACTIVE' && a.checkedInOn >= ini && a.checkedInOn <= fin && liveIds.has(a.memberId))
            .map((a) => ({ memberId: a.memberId, checkedInOn: a.checkedInOn })),
          leads: db.leads
            .filter((l) => !l.deletedAt && l.contactedOn >= ini && l.contactedOn <= fin)
            .map((l) => ({ stage: l.stage, contactedOn: l.contactedOn })),
          availability: {
            hasPriorMembershipData: db.memberships.some((m) => m.status === 'ACTIVE' && m.startsOn < ini),
            attendanceTracked: db.attendances.some((a) => a.status === 'ACTIVE' && a.checkedInOn <= fin),
            leadsTracked: db.leads.some((l) => !l.deletedAt && l.contactedOn <= fin),
          },
        };
      },
      firstDataPeriod: async () => {
        const dates = [
          ...db.memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.startsOn),
          ...db.cash.filter((c) => c.status === 'ACTIVE').map((c) => c.occurredOn),
        ].sort();
        return dates[0] ? Period.ofDate(dates[0]) : null;
      },
      findCurrentSnapshot: async (period) => {
        const s = db.snapshots.find((x) => x.period === period && x.isCurrent && x.stage !== 'REFERENCE');
        return s ? { snapshot: s, values: s.values } : null;
      },
      currentStages: async () =>
        new Map(db.snapshots.filter((s) => s.isCurrent && s.stage !== 'REFERENCE').map((s) => [s.period, s.stage as 'PRELIMINARY' | 'FINAL'])),
      listSnapshots: async (period) => db.snapshots.filter((s) => !period || s.period === period),
      supersede: async (id, at) => {
        const s = db.snapshots.find((x) => x.id === id)!;
        s.isCurrent = false;
        s.supersededAt = at;
      },
      createSnapshot: async (data) => {
        const s = {
          id: randomUUID(),
          period: data.period,
          closedAt: data.closedAt,
          closedByUserId: data.closedByUserId,
          closedByName: data.closedByName,
          source: data.source,
          stage: data.stage,
          isCurrent: true,
          supersededAt: null,
          legacyLabel: null,
          notes: data.notes,
          values: data.values.map((v) => ({ ...v })),
        };
        db.snapshots.push(s);
        return s;
      },
      countChangesAfterClose: async () => 0,
    },
    staff: {
      list: async (includeInactive) =>
        db.staff
          .filter((s) => includeInactive || s.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName))
          .map(toStaff),
      findById: async (id) => {
        const s = db.staff.find((x) => x.id === id);
        return s ? toStaff(s) : null;
      },
      findByDisplayName: async (name, exclude) => {
        const s = db.staff.find((x) => x.displayName.toLowerCase() === name.toLowerCase() && x.id !== exclude);
        return s ? toStaff(s) : null;
      },
      findByUserId: async (userId, exclude) => {
        const s = db.staff.find((x) => x.userId === userId && x.id !== exclude);
        return s ? toStaff(s) : null;
      },
      create: async (data) => {
        const now = clock.now();
        const { createdById: _c, ...rest } = data;
        const s: StaffMemberRecord = { id: randomUUID(), ...rest, user: null, audit: meta(now, now) };
        db.staff.push(s);
        return toStaff(s);
      },
      update: async (id, patch) => {
        const s = db.staff.find((x) => x.id === id)!;
        const { updatedById: _u, ...rest } = patch;
        Object.assign(s, rest);
        s.audit = { ...s.audit, updatedAt: clock.now() };
        return toStaff(s);
      },
    },
    incentives: {
      monthlyFacts: async (from, to, since) => {
        const out = new Map<string, IncentiveMonthlyFactsRecord>(
          Period.range(from, to).map((p) => [
            p,
            { period: p, newMembersByStaff: [], payments: 0, paymentsAmount: 0, otherIncome: 0, expenseGroups: [] },
          ]),
        );
        for (const { membership, member } of firstPayments(since)) {
          const m = out.get(Period.ofDate(membership.startsOn));
          if (!m) continue;
          const row = m.newMembersByStaff.find((r) => r.staffId === member.soldByStaffId);
          if (row) {
            row.count++;
            row.amount += membership.amountTotal;
          } else m.newMembersByStaff.push({ staffId: member.soldByStaffId, count: 1, amount: membership.amountTotal });
        }
        for (const ms of db.memberships.filter((x) => x.status === 'ACTIVE' && liveMember(x.memberId))) {
          const m = out.get(Period.ofDate(ms.startsOn));
          if (!m) continue;
          m.payments++;
          m.paymentsAmount += ms.amountTotal;
        }
        for (const c of db.cash.filter((x) => x.status === 'ACTIVE')) {
          const m = out.get(Period.ofDate(c.occurredOn));
          if (!m) continue;
          if (c.type === 'INCOME') {
            if (c.origin !== 'RENEWAL') m.otherIncome += c.amount;
            continue;
          }
          const categoryName = db.categories.find((x) => x.id === c.categoryId)?.name ?? '';
          const g = m.expenseGroups.find((x) => x.categoryName === categoryName && x.subcategory === c.subcategory);
          if (g) {
            g.amount += c.amount;
            g.count++;
          } else m.expenseGroups.push({ categoryName, subcategory: c.subcategory, amount: c.amount, count: 1 });
        }
        return [...out.values()];
      },
      newMembersInPeriod: async (period, since) =>
        firstPayments(since)
          .filter(({ membership }) => Period.ofDate(membership.startsOn) === period)
          .sort(
            (a, b) =>
              a.membership.startsOn.localeCompare(b.membership.startsOn) || a.member.legacyCode.localeCompare(b.member.legacyCode),
          )
          .map(({ membership, member }) => {
            const staff = member.soldByStaffId ? db.staff.find((x) => x.id === member.soldByStaffId) : undefined;
            return {
              memberId: member.id,
              legacyCode: member.legacyCode,
              firstName: member.firstName,
              lastName: member.lastName,
              paidOn: membership.startsOn,
              amount: membership.amountTotal,
              planName: membership.planName,
              soldBy: staff ? { id: staff.id, displayName: staff.displayName } : null,
            };
          }),
      lastPaymentOn: async (period) => {
        const dates = db.memberships
          .filter((m) => m.status === 'ACTIVE' && liveMember(m.memberId) && Period.ofDate(m.startsOn) === period)
          .map((m) => m.startsOn)
          .sort();
        return dates[dates.length - 1] ?? null;
      },
      findPeriod: async (period) => {
        const r = db.incentivePeriods.find((x) => x.period === period);
        return r ? toIncentive(r) : null;
      },
      listPeriods: async (from, to) =>
        db.incentivePeriods
          .filter((x) => x.period >= from && x.period <= to)
          .sort((a, b) => a.period.localeCompare(b.period))
          .map(toIncentive),
      savePublished: async (data) => {
        const now = clock.now();
        const existing = db.incentivePeriods.find((x) => x.period === data.period);
        const fields = {
          period: data.period,
          status: 'PUBLISHED' as const,
          formulaVersion: data.formulaVersion,
          newMembersTarget: data.newMembersTarget,
          renewalRateTargetPct: data.renewalRateTargetPct,
          expectedExpirations: data.expectedExpirations,
          renewalsTarget: data.renewalsTarget,
          bonusPerNewMemberArs: data.bonusPerNewMemberArs,
          teamBonusPerPersonArs: data.teamBonusPerPersonArs,
          expenseReferenceArs: data.expenseReferenceArs,
          plan: JSON.parse(JSON.stringify(data.plan)) as unknown,
          results: null,
          notes: data.notes,
          publishedAt: data.publishedAt,
          publishedById: data.publishedById,
          closedAt: null,
          closedById: null,
          updatedAt: now,
        };
        if (existing) Object.assign(existing, fields);
        else db.incentivePeriods.push({ id: randomUUID(), createdAt: now, ...fields });
        return toIncentive(db.incentivePeriods.find((x) => x.period === data.period)!);
      },
      saveClosed: async (period, data) => {
        const r = db.incentivePeriods.find((x) => x.period === period)!;
        Object.assign(r, {
          status: 'CLOSED',
          results: JSON.parse(JSON.stringify(data.results)) as unknown,
          closedAt: data.closedAt,
          closedById: data.closedById,
          notes: data.notes,
          updatedAt: clock.now(),
        });
        return toIncentive(r);
      },
    },
    auditLogs: {
      insert: async (r) => {
        db.audit.push(r);
      },
      list: notImplemented('auditLogs.list'),
    },
    jobRuns: {
      start: async (job, at) => {
        const id = randomUUID();
        db.jobRuns.push({ id, job, startedAt: at, finishedAt: null, status: 'RUNNING', result: null, error: null });
        return id;
      },
      finish: async (id, status, at, result, error) => {
        const r = db.jobRuns.find((j) => j.id === id)!;
        Object.assign(r, { status, finishedAt: at, result, error });
      },
      lastFinished: async (job, status) => [...db.jobRuns].reverse().find((j) => j.job === job && j.status === status) ?? null,
    },
    sequences: {
      next: async (name) => ++db.seq[name],
    },
  };
}

/** UnitOfWork en memoria: si `work` lanza, restaura el estado previo (simula el rollback). */
export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly locks = new Set<string>();
  readonly repos: Repositories;

  constructor(
    readonly db: InMemoryDb,
    private readonly clock: Clock,
  ) {
    this.repos = inMemoryRepositories(db, clock);
  }

  private context(): TransactionContext {
    return { ...this.repos, audit: new RepositoryAuditLogger(this.repos.auditLogs, this.clock) };
  }

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const before = this.db.snapshot();
    try {
      return await work(this.context());
    } catch (e) {
      this.db.restore(before);
      throw e;
    }
  }

  async runExclusive<T>(key: string, work: (tx: TransactionContext) => Promise<T>): Promise<ExclusiveResult<T>> {
    if (this.locks.has(key)) return { acquired: false };
    this.locks.add(key);
    try {
      return { acquired: true, result: await this.run(work) };
    } finally {
      this.locks.delete(key);
    }
  }
}

/** Reloj de prueba en America/Argentina/Buenos_Aires (UTC−3 fijo, sin horario de verano). */
export class TestClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }
  today(): DateOnly {
    return this.businessDateOf(this.current);
  }
  timeOfDay(): string {
    return new Date(this.current.getTime() - 3 * 3_600_000).toISOString().slice(11, 16);
  }
  businessDateOf(instant: Date): DateOnly {
    return new Date(instant.getTime() - 3 * 3_600_000).toISOString().slice(0, 10) as DateOnly;
  }
  instantOf(date: DateOnly, time: string): Date {
    return new Date(`${date}T${time}:00-03:00`);
  }
  timeZone(): string {
    return 'America/Argentina/Buenos_Aires';
  }
  advanceMinutes(min: number): void {
    this.current = new Date(this.current.getTime() + min * 60_000);
  }
}

export class FakeHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `fake$${plain}`;
  }
  async verify(hash: string, plain: string): Promise<boolean> {
    return hash === `fake$${plain}`;
  }
}

export class FakeTokenService implements TokenService {
  private n = 0;
  async signAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
    return { token: `access.${claims.sub}.${claims.role}.${claims.mustChangePassword}.${++this.n}`, expiresIn: 900 };
  }
  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    const [kind, sub, role, mcp] = token.split('.');
    return kind === 'access' && sub ? { sub, role: role as AccessTokenClaims['role'], mustChangePassword: mcp === 'true' } : null;
  }
  generateRefreshToken(): string {
    return `refresh-${++this.n}-${randomUUID()}`;
  }
  hashRefreshToken(token: string): string {
    return `sha:${token}`;
  }
  refreshTokenTtlDays(): number {
    return 7;
  }
}

export class FakeSecrets implements SecretGenerator {
  temporaryPassword(): string {
    return 'Temporal1234x';
  }
  uuid(): string {
    return randomUUID();
  }
  uuidFromName(name: string): string {
    return `00000000-0000-5000-8000-${Buffer.from(name).toString('hex').padEnd(12, '0').slice(0, 12)}`;
  }
}
