import { randomUUID } from 'node:crypto';
import { MemberRecord, PlanRecord, StaffMemberRecord, UserRecord } from '../../src/domain/repositories/records';
import { DateOnly } from '../../src/domain/shared/date-only';
import { RequestContext } from '../../src/domain/shared/request-context';
import { InMemoryDb } from './in-memory';

export const D = (s: string): DateOnly => s as DateOnly;

export function makePlan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: randomUUID(),
    code: 'PLUS',
    name: 'Plus (Challenge 90 dias)',
    priceArs: 45000,
    enrollmentFeeArs: 0,
    durationDays: 30,
    requiresAdvance: false,
    advanceInstallments: 0,
    benefits: null,
    nutritionBilling: 'NUTRITIONIST',
    isActive: true,
    notes: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeUser(overrides: Partial<UserRecord> & { password?: string } = {}): UserRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  const { password, ...rest } = overrides;
  return {
    id: randomUUID(),
    email: 'admin@limitbreaker.test',
    passwordHash: `fake$${password ?? 'Secreta123456'}`,
    fullName: 'Admin Prueba',
    role: 'ADMIN',
    isActive: true,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

export function makeMember(overrides: Partial<MemberRecord> = {}): MemberRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: randomUUID(),
    legacyCode: 'LB045',
    firstName: 'Juan',
    lastName: 'Pérez',
    searchName: 'juan perez',
    phoneRaw: '11 5859 3977',
    phoneE164: '+5491158593977',
    phoneNeedsReview: false,
    email: null,
    joinedAt: D('2026-04-01'),
    status: 'ACTIVE',
    currentPlanId: null,
    currentPlan: null,
    lastRenewalAt: null,
    expiresAt: null,
    cancelledAt: null,
    cancellationReason: null,
    acquisitionSource: null,
    notes: null,
    soldByStaffId: null,
    soldBy: null,
    deletedAt: null,
    audit: { createdAt: now, createdBy: null, updatedAt: now, updatedBy: null },
    ...overrides,
  };
}

export function makeStaffMember(overrides: Partial<StaffMemberRecord> = {}): StaffMemberRecord {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: randomUUID(),
    displayName: 'Cristian',
    userId: null,
    user: null,
    isBonusEligible: true,
    isActive: true,
    sortOrder: 1,
    notes: null,
    audit: { createdAt: now, createdBy: null, updatedAt: now, updatedBy: null },
    ...overrides,
  };
}

export interface SeedStaff {
  cristian: StaffMemberRecord;
  maru: StaffMemberRecord;
  aileen: StaffMemberRecord;
  giovanni: StaffMemberRecord;
  lucas: StaffMemberRecord;
}

export interface Seed {
  db: InMemoryDb;
  admin: UserRecord;
  recep: UserRecord;
  plan: PlanRecord;
  renewalCategoryId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
  /** Equipo del plan Fase 4: Maru vinculada a la recepcionista, Lucas al admin; Aileen sin usuario. */
  staff: SeedStaff;
}

/** Base mínima: usuarios, plan, categoría de sistema "Renovación", categorías manuales y parámetros. */
export function seed(): Seed {
  const db = new InMemoryDb();
  const admin = makeUser();
  const recep = makeUser({ email: 'mariel@limitbreaker.test', fullName: 'Mariel', role: 'RECEPCIONISTA', password: 'Mariel123456' });
  const plan = makePlan();
  db.users.push(admin, recep);
  db.plans.push(plan);
  const renewalCategoryId = randomUUID();
  const expenseCategoryId = randomUUID();
  const incomeCategoryId = randomUUID();
  db.categories.push(
    { id: renewalCategoryId, type: 'INCOME', name: 'Renovación', isActive: true, isSystem: true, notes: null, sortOrder: 0 },
    { id: expenseCategoryId, type: 'EXPENSE', name: 'Alquiler', isActive: true, isSystem: false, notes: null, sortOrder: 1 },
    { id: incomeCategoryId, type: 'INCOME', name: 'Venta de bebidas', isActive: true, isSystem: false, notes: null, sortOrder: 2 },
  );
  const now = new Date('2026-01-01T00:00:00Z');
  const setting = (key: string, value: unknown, valueType: string) => ({
    key,
    value,
    valueType,
    group: key.split('.')[0]!,
    label: key,
    description: null,
    updatedAt: now,
    updatedBy: null,
  });
  db.settings.push(
    setting('security.max_failed_attempts', 5, 'number'),
    setting('security.failed_attempts_window_minutes', 15, 'number'),
    setting('members.auto_cancel_after_days', 15, 'number'),
    setting('metrics.renewal_grace_days', 15, 'number'),
  );
  const staff: SeedStaff = {
    cristian: makeStaffMember({ displayName: 'Cristian', isBonusEligible: true, sortOrder: 1 }),
    maru: makeStaffMember({ displayName: 'Maru', userId: recep.id, isBonusEligible: true, sortOrder: 2 }),
    aileen: makeStaffMember({ displayName: 'Aileen', isBonusEligible: true, sortOrder: 3 }),
    giovanni: makeStaffMember({ displayName: 'Giovanni', isBonusEligible: false, sortOrder: 4 }),
    lucas: makeStaffMember({ displayName: 'Lucas', userId: admin.id, isBonusEligible: false, sortOrder: 5 }),
  };
  db.staff.push(staff.cristian, staff.maru, staff.aileen, staff.giovanni, staff.lucas);
  return { db, admin, recep, plan, renewalCategoryId, expenseCategoryId, incomeCategoryId, staff };
}

export function ctxOf(user: UserRecord): RequestContext {
  return {
    actor: { userId: user.id, label: user.fullName, role: user.role },
    meta: { requestId: randomUUID(), ip: '127.0.0.1', userAgent: 'jest' },
  };
}
