import { DateOnly } from '../shared/date-only';
import {
  AttendanceSource,
  AuditAction,
  AuditEntity,
  LeadChannel,
  LeadStage,
  MemberStatus,
  MemberStatusEventType,
  MethodologyVersion,
  MovementOrigin,
  MovementType,
  NutritionBilling,
  PaymentMethod,
  RecordStatus,
  Role,
  SnapshotSource,
  SnapshotStage,
  StoredIncentivePeriodStatus,
} from '../shared/enums';

/** Formas de lectura de las entidades (lo que devuelven los repositorios). */

export interface UserRef {
  id: string;
  fullName: string;
}

export interface AuditMeta {
  createdAt: Date;
  createdBy: UserRef | null;
  updatedAt: Date;
  updatedBy: UserRef | null;
}

export interface MemberRef {
  id: string;
  legacyCode: string;
  fullName: string;
}

/** Persona del equipo (docs/05 StaffRef): "Vendido por" y bonos. */
export interface StaffRef {
  id: string;
  displayName: string;
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface PlanRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryRecord {
  id: string;
  type: MovementType;
  name: string;
  isActive: boolean;
  isSystem: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface MemberRecord {
  id: string;
  legacyCode: string;
  firstName: string;
  lastName: string;
  searchName: string;
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneNeedsReview: boolean;
  email: string | null;
  joinedAt: DateOnly;
  status: MemberStatus;
  currentPlanId: string | null;
  currentPlan: { id: string; name: string } | null;
  lastRenewalAt: DateOnly | null;
  expiresAt: DateOnly | null;
  cancelledAt: DateOnly | null;
  cancellationReason: string | null;
  acquisitionSource: string | null;
  notes: string | null;
  /** Quién cerró la venta (Fase 4). Antes de `metrics.cutover_period` puede ser aproximado o null. */
  soldByStaffId: string | null;
  soldBy: StaffRef | null;
  deletedAt: Date | null;
  audit: AuditMeta;
}

export interface MemberStatusEventRecord {
  id: string;
  memberId: string;
  type: MemberStatusEventType;
  effectiveOn: DateOnly;
  reason: string | null;
  createdBy: UserRef | null;
  createdAt: Date;
}

export interface SplitRecord {
  method: PaymentMethod;
  amount: number;
}

export interface MembershipRecord {
  id: string;
  legacyCode: string | null;
  memberId: string;
  member: MemberRef;
  planId: string | null;
  plan: { id: string; name: string } | null;
  planName: string;
  startsOn: DateOnly;
  expiresOn: DateOnly;
  amountTotal: number;
  cashMovementId: string;
  splits: SplitRecord[];
  status: RecordStatus;
  voidedAt: Date | null;
  voidReason: string | null;
  notes: string | null;
  createdAt: Date;
  audit: AuditMeta;
}

export interface CashMovementRecord {
  id: string;
  legacyCode: string | null;
  occurredOn: DateOnly;
  type: MovementType;
  category: CategoryRecord;
  subcategory: string | null;
  amount: number;
  splits: SplitRecord[];
  description: string | null;
  memberId: string | null;
  member: MemberRef | null;
  origin: MovementOrigin;
  membershipId: string | null;
  status: RecordStatus;
  voidedAt: Date | null;
  voidReason: string | null;
  audit: AuditMeta;
}

/** Fila de la tabla de caja (un split o un movimiento completo). */
export interface CashMovementRowRecord extends CashMovementRecord {
  splitIndex: number | null;
  method: PaymentMethod | null;
  rowAmount: number;
}

export interface CashTotalsRecord {
  income: number;
  expense: number;
  count: number;
  renewalCount: number;
  incomeByMethod: Record<string, number>;
  expenseByMethod: Record<string, number>;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
}

export interface AttendanceRecord {
  id: string;
  memberId: string;
  member: MemberRef;
  checkedInAt: Date;
  checkedInOn: DateOnly;
  source: AttendanceSource;
  notes: string | null;
  status: RecordStatus;
  voidedAt: Date | null;
  voidReason: string | null;
  audit: AuditMeta;
}

export interface LeadRecord {
  id: string;
  legacyCode: string | null;
  contactedOn: DateOnly;
  firstName: string;
  lastName: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  channel: LeadChannel;
  channelDetail: string | null;
  trialClassOn: DateOnly | null;
  trialClassTime: string | null;
  stage: LeadStage;
  handledByUserId: string | null;
  handledBy: UserRef | null;
  handledByName: string | null;
  lostReason: string | null;
  notes: string | null;
  memberId: string | null;
  deletedAt: Date | null;
  audit: AuditMeta;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  valueType: string;
  group: string;
  label: string;
  description: string | null;
  updatedAt: Date;
  updatedBy: UserRef | null;
}

export interface MetricSnapshotRecord {
  id: string;
  period: string;
  closedAt: Date;
  closedByUserId: string | null;
  closedByName: string | null;
  source: SnapshotSource;
  stage: SnapshotStage;
  isCurrent: boolean;
  supersededAt: Date | null;
  legacyLabel: string | null;
  notes: string | null;
}

export interface MetricValueRecord {
  metricKey: string;
  value: number | null;
  methodologyVersion: MethodologyVersion;
  isProvisional: boolean;
}

export interface StaffMemberRecord {
  id: string;
  displayName: string;
  userId: string | null;
  user: UserRef | null;
  isBonusEligible: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  audit: AuditMeta;
}

/** Mes publicado o cerrado de objetivos y bonos (`incentive_periods`). */
export interface IncentivePeriodRecord {
  id: string;
  period: string;
  status: StoredIncentivePeriodStatus;
  formulaVersion: string;
  newMembersTarget: number;
  renewalRateTargetPct: number;
  expectedExpirations: number;
  renewalsTarget: number;
  bonusPerNewMemberArs: number;
  teamBonusPerPersonArs: number;
  expenseReferenceArs: number | null;
  /** IncentivePlan congelado al publicar (JSON tal cual). */
  plan: unknown;
  /** IncentiveProgress final, al cerrar. */
  results: unknown;
  notes: string | null;
  publishedAt: Date;
  publishedBy: UserRef | null;
  closedAt: Date | null;
  closedBy: UserRef | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLogRecord {
  id: string;
  occurredAt: Date;
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

export interface JobRunRecord {
  id: string;
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  result: unknown;
  error: string | null;
}
