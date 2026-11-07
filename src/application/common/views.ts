import { attendanceRisk, AttendanceThresholds } from '../../domain/attendances/attendance-risk';
import { daysToExpire, renewalStatus, RenewalWarnDays } from '../../domain/members/renewal-status';
import {
  AttendanceRecord,
  AuditLogRecord,
  AuditMeta,
  CashMovementRecord,
  CashMovementRowRecord,
  CashTotalsRecord,
  CategoryRecord,
  LeadRecord,
  MemberRecord,
  MemberStatusEventRecord,
  MembershipRecord,
  MetricSnapshotRecord,
  PlanRecord,
  SettingRecord,
  SplitRecord,
  StaffMemberRecord,
  StaffRef,
  UserRecord,
  UserRef,
} from '../../domain/repositories/records';
import { DateOnly } from '../../domain/shared/date-only';
import {
  AttendanceRisk,
  AttendanceSource,
  AuditAction,
  AuditEntity,
  LeadChannel,
  LeadStage,
  MemberStatus,
  MemberStatusEventType,
  MovementOrigin,
  MovementType,
  NutritionBilling,
  PaymentMethod,
  RecordStatus,
  RenewalStatus,
  Role,
} from '../../domain/shared/enums';
import { round2 } from '../../domain/shared/money';
import { fullName } from '../../domain/shared/text';

/**
 * Vistas con la forma exacta de los schemas de docs/05. Las fechas de negocio salen como
 * `YYYY-MM-DD` y las marcas de tiempo como ISO 8601.
 */

export interface PageView<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditMetaView {
  createdAt: string;
  createdBy: UserRef | null;
  updatedAt: string;
  updatedBy: UserRef | null;
}

export function auditMetaView(a: AuditMeta): AuditMetaView {
  return {
    createdAt: a.createdAt.toISOString(),
    createdBy: a.createdBy,
    updatedAt: a.updatedAt.toISOString(),
    updatedBy: a.updatedBy,
  };
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

// ── Usuarios ──

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function userView(u: UserRecord): UserView {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

// ── Planes y categorías ──

export interface PlanView {
  id: string;
  code: string;
  name: string;
  priceArs: number;
  enrollmentFeeArs: number;
  durationDays: number;
  requiresAdvance: boolean;
  advanceInstallments: number;
  benefits: string | null;
  nutritionBilling: NutritionBilling;
  isActive: boolean;
  notes: string | null;
  sortOrder: number;
}

export function planView(p: PlanRecord): PlanView {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    priceArs: p.priceArs,
    enrollmentFeeArs: p.enrollmentFeeArs,
    durationDays: p.durationDays,
    requiresAdvance: p.requiresAdvance,
    advanceInstallments: p.advanceInstallments,
    benefits: p.benefits,
    nutritionBilling: p.nutritionBilling,
    isActive: p.isActive,
    notes: p.notes,
    sortOrder: p.sortOrder,
  };
}

export interface CashCategoryView {
  id: string;
  type: MovementType;
  name: string;
  isActive: boolean;
  isSystem: boolean;
  notes: string | null;
  sortOrder: number;
}

export function categoryView(c: CategoryRecord): CashCategoryView {
  return { id: c.id, type: c.type, name: c.name, isActive: c.isActive, isSystem: c.isSystem, notes: c.notes, sortOrder: c.sortOrder };
}

// ── Socios ──

export interface MemberView {
  id: string;
  legacyCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneNeedsReview: boolean;
  email: string | null;
  joinedAt: DateOnly;
  status: MemberStatus;
  currentPlan: { id: string; name: string } | null;
  lastRenewalAt: DateOnly | null;
  expiresAt: DateOnly | null;
  daysToExpire: number | null;
  renewalStatus: RenewalStatus;
  cancelledAt: DateOnly | null;
  cancellationReason: string | null;
  acquisitionSource: string | null;
  notes: string | null;
  soldBy: StaffRef | null;
  audit: AuditMetaView;
}

export function memberView(m: MemberRecord, today: DateOnly, warn: RenewalWarnDays): MemberView {
  return {
    id: m.id,
    legacyCode: m.legacyCode,
    firstName: m.firstName,
    lastName: m.lastName,
    fullName: fullName(m.firstName, m.lastName),
    phoneRaw: m.phoneRaw,
    phoneE164: m.phoneE164,
    phoneNeedsReview: m.phoneNeedsReview,
    email: m.email,
    joinedAt: m.joinedAt,
    status: m.status,
    currentPlan: m.currentPlan,
    lastRenewalAt: m.lastRenewalAt,
    expiresAt: m.expiresAt,
    daysToExpire: daysToExpire(m.expiresAt, today),
    renewalStatus: renewalStatus(m, today, warn),
    cancelledAt: m.cancelledAt,
    cancellationReason: m.cancellationReason,
    acquisitionSource: m.acquisitionSource,
    notes: m.notes,
    soldBy: m.soldBy ? { id: m.soldBy.id, displayName: m.soldBy.displayName } : null,
    audit: auditMetaView(m.audit),
  };
}

export interface MemberStatusEventView {
  id: string;
  type: MemberStatusEventType;
  effectiveOn: DateOnly;
  reason: string | null;
  createdBy: UserRef | null;
  createdAt: string;
}

export function statusEventView(e: MemberStatusEventRecord): MemberStatusEventView {
  return {
    id: e.id,
    type: e.type,
    effectiveOn: e.effectiveOn,
    reason: e.reason,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toISOString(),
  };
}

export interface MemberDetailView extends MemberView {
  currentMembership: MembershipView | null;
  lastAttendanceAt: string | null;
  daysSinceLastAttendance: number | null;
  attendanceRisk: AttendanceRisk;
  statusEvents: MemberStatusEventView[];
}

export function memberDetailView(
  m: MemberRecord,
  today: DateOnly,
  warn: RenewalWarnDays,
  thresholds: AttendanceThresholds,
  extra: {
    currentMembership: MembershipRecord | null;
    lastAttendance: { checkedInAt: Date; checkedInOn: DateOnly } | null;
    statusEvents: MemberStatusEventRecord[];
  },
): MemberDetailView {
  const risk = attendanceRisk(
    { lastAttendanceOn: extra.lastAttendance?.checkedInOn ?? null, joinedAt: m.joinedAt },
    today,
    thresholds,
  );
  return {
    ...memberView(m, today, warn),
    currentMembership: extra.currentMembership ? membershipView(extra.currentMembership) : null,
    lastAttendanceAt: extra.lastAttendance ? extra.lastAttendance.checkedInAt.toISOString() : null,
    daysSinceLastAttendance: extra.lastAttendance ? risk.daysSinceLastAttendance : null,
    attendanceRisk: risk.risk,
    statusEvents: extra.statusEvents.map(statusEventView),
  };
}

// ── Renovaciones ──

export interface PaymentSplitView {
  method: PaymentMethod;
  amount: number;
}

const splitViews = (splits: SplitRecord[]): PaymentSplitView[] => splits.map((s) => ({ method: s.method, amount: s.amount }));

export interface MembershipView {
  id: string;
  legacyCode: string | null;
  member: { id: string; legacyCode: string; fullName: string };
  plan: { id: string; name: string } | null;
  planName: string;
  startsOn: DateOnly;
  expiresOn: DateOnly;
  amountTotal: number;
  splits: PaymentSplitView[];
  cashMovementId: string;
  status: RecordStatus;
  voidedAt: string | null;
  voidReason: string | null;
  notes: string | null;
  audit: AuditMetaView;
}

export function membershipView(m: MembershipRecord): MembershipView {
  return {
    id: m.id,
    legacyCode: m.legacyCode,
    member: m.member,
    plan: m.plan,
    planName: m.planName,
    startsOn: m.startsOn,
    expiresOn: m.expiresOn,
    amountTotal: m.amountTotal,
    splits: splitViews(m.splits),
    cashMovementId: m.cashMovementId,
    status: m.status,
    voidedAt: iso(m.voidedAt),
    voidReason: m.voidReason,
    notes: m.notes,
    audit: auditMetaView(m.audit),
  };
}

// ── Asistencias ──

export interface AttendanceView {
  id: string;
  member: { id: string; legacyCode: string; fullName: string };
  checkedInAt: string;
  checkedInOn: DateOnly;
  source: AttendanceSource;
  notes: string | null;
  status: RecordStatus;
  voidReason: string | null;
  audit: AuditMetaView;
}

export function attendanceView(a: AttendanceRecord): AttendanceView {
  return {
    id: a.id,
    member: a.member,
    checkedInAt: a.checkedInAt.toISOString(),
    checkedInOn: a.checkedInOn,
    source: a.source,
    notes: a.notes,
    status: a.status,
    voidReason: a.voidReason,
    audit: auditMetaView(a.audit),
  };
}

// ── Caja ──

export interface CashMovementView {
  id: string;
  legacyCode: string | null;
  occurredOn: DateOnly;
  type: MovementType;
  category: CashCategoryView;
  subcategory: string | null;
  amount: number;
  splits: PaymentSplitView[];
  description: string | null;
  member: { id: string; legacyCode: string; fullName: string } | null;
  origin: MovementOrigin;
  membershipId: string | null;
  status: RecordStatus;
  voidedAt: string | null;
  voidReason: string | null;
  audit: AuditMetaView;
}

export function cashMovementView(c: CashMovementRecord): CashMovementView {
  return {
    id: c.id,
    legacyCode: c.legacyCode,
    occurredOn: c.occurredOn,
    type: c.type,
    category: categoryView(c.category),
    subcategory: c.subcategory,
    amount: c.amount,
    splits: splitViews(c.splits),
    description: c.description,
    member: c.member,
    origin: c.origin,
    membershipId: c.membershipId,
    status: c.status,
    voidedAt: iso(c.voidedAt),
    voidReason: c.voidReason,
    audit: auditMetaView(c.audit),
  };
}

export interface CashMovementRowView extends CashMovementView {
  splitIndex: number | null;
  method: PaymentMethod | null;
  rowAmount: number;
  signedAmount: number;
}

export function cashRowView(r: CashMovementRowRecord): CashMovementRowView {
  return {
    ...cashMovementView(r),
    splitIndex: r.splitIndex,
    method: r.method,
    rowAmount: r.rowAmount,
    signedAmount: r.type === 'EXPENSE' ? -r.rowAmount : r.rowAmount,
  };
}

export interface CashTotalsView {
  income: number;
  expense: number;
  net: number;
  count: number;
  renewalCount: number;
  incomeByMethod: Record<string, number>;
  expenseByMethod: Record<string, number>;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
}

export function cashTotalsView(t: CashTotalsRecord): CashTotalsView {
  return {
    income: round2(t.income),
    expense: round2(t.expense),
    net: round2(t.income - t.expense),
    count: t.count,
    renewalCount: t.renewalCount,
    incomeByMethod: t.incomeByMethod,
    expenseByMethod: t.expenseByMethod,
    incomeByCategory: t.incomeByCategory,
    expenseByCategory: t.expenseByCategory,
  };
}

// ── Leads ──

export interface LeadView {
  id: string;
  legacyCode: string | null;
  contactedOn: DateOnly;
  firstName: string;
  lastName: string | null;
  fullName: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  channel: LeadChannel;
  channelDetail: string | null;
  trialClassOn: DateOnly | null;
  trialClassTime: string | null;
  stage: LeadStage;
  handledBy: UserRef | null;
  handledByName: string | null;
  lostReason: string | null;
  notes: string | null;
  memberId: string | null;
  audit: AuditMetaView;
}

export function leadView(l: LeadRecord): LeadView {
  return {
    id: l.id,
    legacyCode: l.legacyCode,
    contactedOn: l.contactedOn,
    firstName: l.firstName,
    lastName: l.lastName,
    fullName: fullName(l.firstName, l.lastName),
    phoneRaw: l.phoneRaw,
    phoneE164: l.phoneE164,
    channel: l.channel,
    channelDetail: l.channelDetail,
    trialClassOn: l.trialClassOn,
    trialClassTime: l.trialClassTime,
    stage: l.stage,
    handledBy: l.handledBy,
    handledByName: l.handledByName,
    lostReason: l.lostReason,
    notes: l.notes,
    memberId: l.memberId,
    audit: auditMetaView(l.audit),
  };
}

// ── Auditoría y parámetros ──

export interface AuditLogView {
  id: string;
  occurredAt: string;
  user: UserRef | null;
  actorLabel: string;
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  passwordConfirmed: boolean;
  requestId: string | null;
}

export function auditLogView(a: AuditLogRecord): AuditLogView {
  return {
    id: a.id,
    occurredAt: a.occurredAt.toISOString(),
    user: a.user,
    actorLabel: a.actorLabel,
    entity: a.entity,
    entityId: a.entityId,
    entityLabel: a.entityLabel,
    action: a.action,
    before: a.before,
    after: a.after,
    changedFields: a.changedFields,
    passwordConfirmed: a.passwordConfirmed,
    requestId: a.requestId,
  };
}

export interface SettingView {
  key: string;
  value: unknown;
  valueType: string;
  group: string;
  label: string;
  description: string | null;
  updatedAt: string;
  updatedBy: UserRef | null;
}

export function settingView(s: SettingRecord): SettingView {
  return {
    key: s.key,
    value: s.value,
    valueType: s.valueType,
    group: s.group,
    label: s.label,
    description: s.description,
    updatedAt: s.updatedAt.toISOString(),
    updatedBy: s.updatedBy,
  };
}

export interface MetricSnapshotInfoView {
  id: string;
  period: string;
  closedAt: string;
  closedBy: string | null;
  source: 'IMPORT' | 'AUTO' | 'MANUAL';
  stage: 'PRELIMINARY' | 'FINAL' | 'REFERENCE';
  isCurrent: boolean;
  supersededAt: string | null;
  legacyLabel: string | null;
  notes: string | null;
}

export function snapshotInfoView(s: MetricSnapshotRecord): MetricSnapshotInfoView {
  return {
    id: s.id,
    period: s.period,
    closedAt: s.closedAt.toISOString(),
    closedBy: s.closedByName,
    source: s.source,
    stage: s.stage,
    isCurrent: s.isCurrent,
    supersededAt: iso(s.supersededAt),
    legacyLabel: s.legacyLabel,
    notes: s.notes,
  };
}

// ── Equipo (Fase 4) ──

export interface StaffMemberView {
  id: string;
  displayName: string;
  user: UserRef | null;
  isBonusEligible: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  audit: AuditMetaView;
}

export function staffMemberView(s: StaffMemberRecord): StaffMemberView {
  return {
    id: s.id,
    displayName: s.displayName,
    user: s.user,
    isBonusEligible: s.isBonusEligible,
    isActive: s.isActive,
    sortOrder: s.sortOrder,
    notes: s.notes,
    audit: auditMetaView(s.audit),
  };
}

/** Opción del selector "Vendido por": sin datos de bono. */
export interface StaffOptionView {
  id: string;
  displayName: string;
  isCurrentUser: boolean;
}
