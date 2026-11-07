import {
  AttendanceRecord,
  CashMovementRecord,
  CategoryRecord,
  IncentivePeriodRecord,
  LeadRecord,
  MemberRecord,
  MembershipRecord,
  PlanRecord,
  StaffMemberRecord,
  UserRecord,
} from '../../domain/repositories/records';
import { fullName } from '../../domain/shared/text';

/**
 * Fotos `before` / `after` de cada entidad para la auditoría. Claves en camelCase y fechas de
 * negocio como `YYYY-MM-DD`: `changesAfterClose` busca esas claves de fecha en el JSON.
 * Nunca incluyen `passwordHash`, tokens ni contraseñas ingresadas.
 */

export function userSnapshot(u: UserRecord): Record<string, unknown> {
  return {
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
  };
}

export function userLabel(u: { fullName: string; email: string }): string {
  return `${u.fullName} <${u.email}>`;
}

export function planSnapshot(p: PlanRecord): Record<string, unknown> {
  return {
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

export const planLabel = (p: PlanRecord): string => `${p.code} – ${p.name}`;

export function categorySnapshot(c: CategoryRecord): Record<string, unknown> {
  return { type: c.type, name: c.name, isActive: c.isActive, isSystem: c.isSystem, notes: c.notes, sortOrder: c.sortOrder };
}

export const categoryLabel = (c: CategoryRecord): string => `${c.type === 'INCOME' ? 'Ingreso' : 'Egreso'} · ${c.name}`;

export function memberSnapshot(m: MemberRecord): Record<string, unknown> {
  return {
    legacyCode: m.legacyCode,
    firstName: m.firstName,
    lastName: m.lastName,
    phoneRaw: m.phoneRaw,
    phoneE164: m.phoneE164,
    phoneNeedsReview: m.phoneNeedsReview,
    email: m.email,
    joinedAt: m.joinedAt,
    status: m.status,
    currentPlanId: m.currentPlanId,
    currentPlanName: m.currentPlan?.name ?? null,
    lastRenewalAt: m.lastRenewalAt,
    expiresAt: m.expiresAt,
    cancelledAt: m.cancelledAt,
    cancellationReason: m.cancellationReason,
    acquisitionSource: m.acquisitionSource,
    notes: m.notes,
    soldByStaffId: m.soldByStaffId,
    soldByName: m.soldBy?.displayName ?? null,
    deletedAt: m.deletedAt,
  };
}

/** `LB045 – Juan Pérez`. */
export const memberLabel = (m: { legacyCode: string; firstName: string; lastName: string }): string =>
  `${m.legacyCode} – ${fullName(m.firstName, m.lastName)}`;

export function membershipSnapshot(m: MembershipRecord): Record<string, unknown> {
  return {
    legacyCode: m.legacyCode,
    memberId: m.memberId,
    memberLabel: `${m.member.legacyCode} – ${m.member.fullName}`,
    planId: m.planId,
    planName: m.planName,
    startsOn: m.startsOn,
    expiresOn: m.expiresOn,
    amountTotal: m.amountTotal,
    splits: m.splits.map((s) => ({ method: s.method, amount: s.amount })),
    cashMovementId: m.cashMovementId,
    status: m.status,
    voidReason: m.voidReason,
    notes: m.notes,
  };
}

export const membershipLabel = (m: MembershipRecord): string =>
  `${m.legacyCode ?? m.id.slice(0, 8)} – ${m.member.legacyCode} ${m.member.fullName}`;

export function cashSnapshot(c: CashMovementRecord): Record<string, unknown> {
  return {
    legacyCode: c.legacyCode,
    occurredOn: c.occurredOn,
    type: c.type,
    categoryId: c.category.id,
    categoryName: c.category.name,
    subcategory: c.subcategory,
    amount: c.amount,
    splits: c.splits.map((s) => ({ method: s.method, amount: s.amount })),
    description: c.description,
    memberId: c.memberId,
    origin: c.origin,
    status: c.status,
    voidReason: c.voidReason,
  };
}

export const cashLabel = (c: CashMovementRecord): string =>
  `${c.legacyCode ?? c.id.slice(0, 8)} – ${c.type === 'INCOME' ? 'Ingreso' : 'Egreso'} ${c.category.name}`;

export function attendanceSnapshot(a: AttendanceRecord): Record<string, unknown> {
  return {
    memberId: a.memberId,
    memberLabel: `${a.member.legacyCode} – ${a.member.fullName}`,
    checkedInAt: a.checkedInAt,
    checkedInOn: a.checkedInOn,
    source: a.source,
    notes: a.notes,
    status: a.status,
    voidReason: a.voidReason,
  };
}

export const attendanceLabel = (a: AttendanceRecord): string =>
  `${a.member.legacyCode} – ${a.member.fullName} · ${a.checkedInOn}`;

export function leadSnapshot(l: LeadRecord): Record<string, unknown> {
  return {
    legacyCode: l.legacyCode,
    contactedOn: l.contactedOn,
    firstName: l.firstName,
    lastName: l.lastName,
    phoneRaw: l.phoneRaw,
    channel: l.channel,
    channelDetail: l.channelDetail,
    trialClassOn: l.trialClassOn,
    trialClassTime: l.trialClassTime,
    stage: l.stage,
    handledByUserId: l.handledByUserId,
    handledByName: l.handledByName,
    lostReason: l.lostReason,
    notes: l.notes,
    memberId: l.memberId,
    deletedAt: l.deletedAt,
  };
}

export const leadLabel = (l: LeadRecord): string => `${l.legacyCode ?? l.id.slice(0, 8)} – ${fullName(l.firstName, l.lastName)}`;

export function staffSnapshot(s: StaffMemberRecord): Record<string, unknown> {
  return {
    displayName: s.displayName,
    userId: s.userId,
    userName: s.user?.fullName ?? null,
    isBonusEligible: s.isBonusEligible,
    isActive: s.isActive,
    sortOrder: s.sortOrder,
    notes: s.notes,
  };
}

/** Cifras clave de un mes de objetivos y bonos (el plan completo queda en la tabla). */
export function incentivePeriodSnapshot(p: IncentivePeriodRecord): Record<string, unknown> {
  const results = (p.results ?? null) as { totals?: unknown; newMembers?: unknown; renewals?: unknown } | null;
  return {
    period: p.period,
    status: p.status,
    formulaVersion: p.formulaVersion,
    newMembersTarget: p.newMembersTarget,
    renewalRateTargetPct: p.renewalRateTargetPct,
    expectedExpirations: p.expectedExpirations,
    renewalsTarget: p.renewalsTarget,
    bonusPerNewMemberArs: p.bonusPerNewMemberArs,
    teamBonusPerPersonArs: p.teamBonusPerPersonArs,
    expenseReferenceArs: p.expenseReferenceArs,
    notes: p.notes,
    ...(results ? { totals: results.totals ?? null, newMembers: results.newMembers ?? null, renewals: results.renewals ?? null } : {}),
  };
}

export const incentivePeriodLabel = (period: string): string => `Objetivos y bonos ${period}`;
