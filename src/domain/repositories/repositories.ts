import { AttendanceThresholds } from '../attendances/attendance-risk';
import { AuditRecord } from '../audit/audit-entry';
import { RenewalWarnDays } from '../members/renewal-status';
import { MetricsDataset } from '../metrics/metrics-calculator';
import { DateOnly } from '../shared/date-only';
import {
  AttendanceRisk,
  AttendanceSource,
  AuditAction,
  AuditEntity,
  JobName,
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
  RenewalStatus,
  Role,
  SnapshotSource,
  SnapshotStage,
} from '../shared/enums';
import { Period } from '../shared/period';
import {
  AttendanceRecord,
  AuditLogRecord,
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
  StaffRef,
  UserRecord,
} from './records';

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

// ───────────── Usuarios y sesiones ─────────────

export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface UserPatch {
  fullName?: string;
  role?: Role;
  isActive?: boolean;
  passwordHash?: string;
  mustChangePassword?: boolean;
  lastLoginAt?: Date;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  list(filter: { role?: Role; isActive?: boolean }, page: PageRequest): Promise<Paged<UserRecord>>;
  create(data: NewUser): Promise<UserRecord>;
  update(id: string, patch: UserPatch): Promise<UserRecord>;
  countActiveAdmins(): Promise<number>;
}

export interface RefreshTokenRepository {
  create(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Revoca solo si sigue activo; devuelve false si ya estaba revocado (detección de reuso). */
  revokeIfActive(id: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<number>;
  revokeAllForUser(userId: string, at: Date): Promise<number>;
}

// ───────────── Catálogos ─────────────

export interface PlanData {
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

export interface PlanRepository {
  list(includeInactive: boolean): Promise<PlanRecord[]>;
  findById(id: string): Promise<PlanRecord | null>;
  findByCode(code: string): Promise<PlanRecord | null>;
  findByName(name: string): Promise<PlanRecord | null>;
  create(data: PlanData): Promise<PlanRecord>;
  update(id: string, patch: Partial<PlanData>): Promise<PlanRecord>;
}

export interface CategoryData {
  type: MovementType;
  name: string;
  isActive: boolean;
  notes: string | null;
  sortOrder: number;
}

export interface CategoryRepository {
  list(filter: { type?: MovementType; includeInactive: boolean }): Promise<CategoryRecord[]>;
  findById(id: string): Promise<CategoryRecord | null>;
  findByTypeAndName(type: MovementType, name: string): Promise<CategoryRecord | null>;
  /** Categoría de sistema INCOME "Renovación". */
  findRenewalCategory(): Promise<CategoryRecord | null>;
  create(data: CategoryData): Promise<CategoryRecord>;
  update(id: string, patch: Partial<CategoryData>): Promise<CategoryRecord>;
  countMovements(id: string): Promise<number>;
}

// ───────────── Socios ─────────────

export type MemberSort = 'priority' | 'lastName' | 'expiresAt' | 'lastRenewalAt' | 'joinedAt';

export interface MemberListQuery {
  today: DateOnly;
  warnDays: RenewalWarnDays;
  /** Texto ya normalizado como `search_name`. */
  q: string | null;
  status: MemberStatus;
  renewalStatus: RenewalStatus[] | null;
  planId: string | null;
  renewedFrom: DateOnly | null;
  renewedTo: DateOnly | null;
  sort: MemberSort;
  order: 'asc' | 'desc';
  page: PageRequest;
}

export interface MemberSummaryCounts {
  registered: number;
  activeUpToDate: number;
  expired: number;
  dueToday: number;
  due3d: number;
  due7d: number;
  ok: number;
  unknown: number;
  cancelled: number;
}

export interface CheckInSuggestionRow {
  id: string;
  legacyCode: string;
  firstName: string;
  lastName: string;
  status: MemberStatus;
  expiresAt: DateOnly | null;
  planName: string | null;
  lastCheckInToday: Date | null;
}

export interface NewMember {
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
  acquisitionSource: string | null;
  notes: string | null;
  soldByStaffId: string | null;
  createdById: string | null;
}

export interface MemberPatch {
  firstName?: string;
  lastName?: string;
  searchName?: string;
  phoneRaw?: string | null;
  phoneE164?: string | null;
  phoneNeedsReview?: boolean;
  email?: string | null;
  status?: MemberStatus;
  currentPlanId?: string | null;
  lastRenewalAt?: DateOnly | null;
  expiresAt?: DateOnly | null;
  cancelledAt?: DateOnly | null;
  cancellationReason?: string | null;
  acquisitionSource?: string | null;
  notes?: string | null;
  soldByStaffId?: string | null;
  deletedAt?: Date | null;
  updatedById?: string | null;
}

export interface NutritionQuery {
  today: DateOnly;
  q: string | null;
  status: MemberStatus;
  nutritionBilling: NutritionBilling | null;
  page: PageRequest;
}

export interface NutritionRow {
  id: string;
  legacyCode: string;
  firstName: string;
  lastName: string;
  status: MemberStatus;
  expiresAt: DateOnly | null;
  plan: { id: string; name: string; nutritionBilling: NutritionBilling } | null;
  planSource: 'CURRENT_MEMBERSHIP' | 'MEMBER_PLAN' | 'NONE';
  membershipStartsOn: DateOnly | null;
  membershipExpiresOn: DateOnly | null;
}

export interface MemberRepository {
  /** Incluye socios anulados (`deletedAt`); el caso de uso decide. */
  findById(id: string): Promise<MemberRecord | null>;
  findActiveBySearchName(searchName: string, excludeId?: string): Promise<{ id: string; legacyCode: string } | null>;
  create(data: NewMember): Promise<MemberRecord>;
  update(id: string, patch: MemberPatch): Promise<MemberRecord>;
  list(query: MemberListQuery): Promise<Paged<MemberRecord>>;
  summary(today: DateOnly, warnDays: RenewalWarnDays): Promise<MemberSummaryCounts>;
  searchForCheckIn(q: string, limit: number, today: DateOnly): Promise<CheckInSuggestionRow[]>;
  /** ACTIVE, no anulados, con vencimiento anterior a `expiresBefore`. */
  findAutoCancelCandidates(expiresBefore: DateOnly): Promise<MemberRecord[]>;
  /** Tiene movimientos de caja, membresías o asistencias activas. */
  hasActivity(id: string): Promise<boolean>;
  addStatusEvent(data: {
    memberId: string;
    type: MemberStatusEventType;
    effectiveOn: DateOnly;
    reason: string | null;
    createdById: string | null;
  }): Promise<MemberStatusEventRecord>;
  listStatusEvents(memberId: string): Promise<MemberStatusEventRecord[]>;
  lastCancellationEvent(memberId: string): Promise<MemberStatusEventRecord | null>;
  listNutrition(query: NutritionQuery): Promise<Paged<NutritionRow>>;
}

// ───────────── Renovaciones ─────────────

export interface MembershipFilter {
  memberId: string | null;
  from: DateOnly | null;
  to: DateOnly | null;
  planId: string | null;
  method: PaymentMethod | null;
  status: RecordStatus | null;
}

export interface NewMembership {
  legacyCode: string;
  memberId: string;
  planId: string | null;
  planName: string;
  startsOn: DateOnly;
  expiresOn: DateOnly;
  amountTotal: number;
  cashMovementId: string;
  notes: string | null;
  createdById: string | null;
}

export interface MembershipPatch {
  planId?: string | null;
  planName?: string;
  startsOn?: DateOnly;
  expiresOn?: DateOnly;
  amountTotal?: number;
  notes?: string | null;
  status?: RecordStatus;
  voidedAt?: Date | null;
  voidedById?: string | null;
  voidReason?: string | null;
  updatedById?: string | null;
}

export interface MembershipRepository {
  findById(id: string): Promise<MembershipRecord | null>;
  listByMember(memberId: string, includeVoided: boolean): Promise<MembershipRecord[]>;
  list(filter: MembershipFilter, page: PageRequest): Promise<Paged<MembershipRecord>>;
  totals(filter: MembershipFilter): Promise<{ count: number; amountTotal: number }>;
  create(data: NewMembership): Promise<MembershipRecord>;
  update(id: string, patch: MembershipPatch): Promise<MembershipRecord>;
}

// ───────────── Caja ─────────────

export interface CashFilter {
  from: DateOnly;
  to: DateOnly;
  type: MovementType | null;
  categoryId: string | null;
  method: PaymentMethod | null;
  origin: MovementOrigin | null;
  memberId: string | null;
  /** Texto libre ya recortado (se busca en descripción, subcategoría, código y socio). */
  q: string | null;
  createdBy: string | null;
  status: RecordStatus;
}

export interface NewCashMovement {
  legacyCode: string | null;
  occurredOn: DateOnly;
  type: MovementType;
  categoryId: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
  memberId: string | null;
  origin: MovementOrigin;
  splits: SplitRecord[];
  createdById: string | null;
}

export interface CashMovementPatch {
  occurredOn?: DateOnly;
  categoryId?: string;
  subcategory?: string | null;
  amount?: number;
  description?: string | null;
  memberId?: string | null;
  status?: RecordStatus;
  voidedAt?: Date | null;
  voidedById?: string | null;
  voidReason?: string | null;
  updatedById?: string | null;
  /** Si viene, reemplaza los splits. */
  splits?: SplitRecord[];
}

export interface CashMovementRepository {
  findById(id: string): Promise<CashMovementRecord | null>;
  create(data: NewCashMovement): Promise<CashMovementRecord>;
  update(id: string, patch: CashMovementPatch): Promise<CashMovementRecord>;
  /** Página de filas; `expandSplits` = una fila por split. Mismo WHERE que `totals`. */
  list(filter: CashFilter, page: PageRequest, expandSplits: boolean): Promise<Paged<CashMovementRowRecord>>;
  /** Totales calculados en SQL sobre el conjunto filtrado completo. */
  totals(filter: CashFilter): Promise<CashTotalsRecord>;
}

// ───────────── Asistencias ─────────────

export interface AttendanceFilter {
  from: DateOnly | null;
  to: DateOnly | null;
  memberId: string | null;
  status: RecordStatus | null;
}

export interface AttendanceRiskQuery {
  today: DateOnly;
  thresholds: AttendanceThresholds;
  risk: AttendanceRisk[] | null;
  q: string | null;
  page: PageRequest;
}

export interface AttendanceRiskRowRecord {
  member: MemberRecord;
  lastAttendanceAt: Date | null;
  lastAttendanceOn: DateOnly | null;
}

export interface AttendanceRiskCounts {
  activeUpToDate: number;
  ok: number;
  medium: number;
  high: number;
  critical: number;
  noAttendance: number;
}

export interface NewAttendance {
  memberId: string;
  checkedInAt: Date;
  checkedInOn: DateOnly;
  source: AttendanceSource;
  notes: string | null;
  createdById: string | null;
}

export interface AttendancePatch {
  memberId?: string;
  checkedInAt?: Date;
  checkedInOn?: DateOnly;
  notes?: string | null;
  status?: RecordStatus;
  voidedAt?: Date | null;
  voidedById?: string | null;
  voidReason?: string | null;
  updatedById?: string | null;
}

export interface AttendanceRepository {
  findById(id: string): Promise<AttendanceRecord | null>;
  create(data: NewAttendance): Promise<AttendanceRecord>;
  update(id: string, patch: AttendancePatch): Promise<AttendanceRecord>;
  findActiveOnDate(memberId: string, date: DateOnly, excludeId?: string): Promise<AttendanceRecord | null>;
  list(filter: AttendanceFilter, page: PageRequest): Promise<Paged<AttendanceRecord>>;
  totals(filter: AttendanceFilter): Promise<{ count: number; distinctMembers: number }>;
  lastActive(memberId: string): Promise<{ checkedInAt: Date; checkedInOn: DateOnly } | null>;
  riskList(query: AttendanceRiskQuery): Promise<Paged<AttendanceRiskRowRecord>>;
  riskSummary(today: DateOnly, thresholds: AttendanceThresholds): Promise<AttendanceRiskCounts>;
  countOnDate(date: DateOnly): Promise<number>;
}

// ───────────── Leads ─────────────

export interface LeadFilter {
  contactedFrom: DateOnly | null;
  stage: LeadStage | null;
  q: string | null;
}

export interface LeadData {
  legacyCode?: string | null;
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
  handledByName: string | null;
  lostReason: string | null;
  notes: string | null;
  memberId: string | null;
}

export interface LeadRepository {
  list(filter: LeadFilter): Promise<LeadRecord[]>;
  /** Leads no eliminados con fecha de contacto en el rango (métricas y resumen). */
  listContactedBetween(from: DateOnly, to: DateOnly): Promise<{ stage: LeadStage; contactedOn: DateOnly }[]>;
  findById(id: string): Promise<LeadRecord | null>;
  create(data: LeadData & { legacyCode: string; createdById: string | null }): Promise<LeadRecord>;
  update(id: string, patch: Partial<LeadData> & { deletedAt?: Date | null; updatedById?: string | null }): Promise<LeadRecord>;
}

// ───────────── Parámetros ─────────────

export interface SettingsRepository {
  getAll(): Promise<SettingRecord[]>;
  upsert(data: {
    key: string;
    value: unknown;
    valueType: string;
    group: string;
    label: string;
    updatedById: string | null;
  }): Promise<SettingRecord>;
}

// ───────────── Métricas ─────────────

export interface NewSnapshot {
  period: Period;
  closedAt: Date;
  closedByUserId: string | null;
  closedByName: string;
  source: SnapshotSource;
  stage: SnapshotStage;
  notes: string | null;
  values: { metricKey: string; value: number | null; methodologyVersion: MethodologyVersion; isProvisional: boolean }[];
}

export interface MetricsRepository {
  loadDataset(period: Period, graceDays: number): Promise<MetricsDataset>;
  /** Primer mes con pagos o movimientos (abril 2026 tras la importación). */
  firstDataPeriod(): Promise<Period | null>;
  /** Snapshot vigente que no es REFERENCE, con sus valores. */
  findCurrentSnapshot(period: Period): Promise<{ snapshot: MetricSnapshotRecord; values: MetricValueRecord[] } | null>;
  /** Etapa del cierre vigente (no REFERENCE) por período. */
  currentStages(): Promise<Map<string, 'PRELIMINARY' | 'FINAL'>>;
  /** Todos los snapshots (incluye REFERENCE y reemplazados), opcionalmente de un período. */
  listSnapshots(period: Period | null): Promise<MetricSnapshotRecord[]>;
  supersede(snapshotId: string, at: Date): Promise<void>;
  createSnapshot(data: NewSnapshot): Promise<MetricSnapshotRecord>;
  /** Cambios auditados con fecha del período registrados después de `closedAt`. */
  countChangesAfterClose(period: Period, closedAt: Date): Promise<number>;
}

// ───────────── Equipo y objetivos (Fase 4) ─────────────

export interface StaffMemberData {
  displayName: string;
  userId: string | null;
  isBonusEligible: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
}

export interface StaffMemberRepository {
  /** Orden: `sortOrder`, luego nombre. */
  list(includeInactive: boolean): Promise<StaffMemberRecord[]>;
  findById(id: string): Promise<StaffMemberRecord | null>;
  /** Comparación sin mayúsculas (el UNIQUE de la base es exacto). */
  findByDisplayName(displayName: string, excludeId?: string): Promise<StaffMemberRecord | null>;
  findByUserId(userId: string, excludeId?: string): Promise<StaffMemberRecord | null>;
  create(data: StaffMemberData & { createdById: string | null }): Promise<StaffMemberRecord>;
  update(id: string, patch: Partial<StaffMemberData> & { updatedById?: string | null }): Promise<StaffMemberRecord>;
}

/** Hechos crudos de un mes para objetivos y bonos (docs/03 §8). Montos en ARS. */
export interface IncentiveMonthlyFactsRecord {
  period: Period;
  /** Altas con cobro (primera membresía ACTIVE, `joined_at` ≥ `newMemberSince`) por "Vendido por" (null = sin asignar). */
  newMembersByStaff: { staffId: string | null; count: number; amount: number }[];
  /** Todas las membresías ACTIVE que empiezan en el mes (altas incluidas). */
  payments: number;
  paymentsAmount: number;
  /** Ingresos ACTIVE que no son de renovación. */
  otherIncome: number;
  /** Egresos ACTIVE agrupados por categoría y subcategoría. */
  expenseGroups: { categoryName: string; subcategory: string | null; amount: number; count: number }[];
}

export interface IncentiveNewMemberRecord {
  memberId: string;
  legacyCode: string;
  firstName: string;
  lastName: string;
  paidOn: DateOnly;
  amount: number;
  planName: string;
  soldBy: StaffRef | null;
}

export interface PublishedIncentivePeriodData {
  period: Period;
  formulaVersion: string;
  newMembersTarget: number;
  renewalRateTargetPct: number;
  expectedExpirations: number;
  renewalsTarget: number;
  bonusPerNewMemberArs: number;
  teamBonusPerPersonArs: number;
  expenseReferenceArs: number | null;
  plan: unknown;
  notes: string | null;
  publishedAt: Date;
  publishedById: string | null;
}

export interface IncentivesRepository {
  /** Un registro por mes de `from` a `to` (los meses sin datos vienen en cero). SQL con ROW_NUMBER. */
  monthlyFacts(from: Period, to: Period, newMemberSince: DateOnly): Promise<IncentiveMonthlyFactsRecord[]>;
  /** Altas con cobro del mes con su "Vendido por", ordenadas por fecha de pago. */
  newMembersInPeriod(period: Period, newMemberSince: DateOnly): Promise<IncentiveNewMemberRecord[]>;
  /** Fecha del último cobro (membresía ACTIVE) del mes. */
  lastPaymentOn(period: Period): Promise<DateOnly | null>;
  findPeriod(period: Period): Promise<IncentivePeriodRecord | null>;
  listPeriods(from: Period, to: Period): Promise<IncentivePeriodRecord[]>;
  /** Crea o reemplaza el mes publicado (status PUBLISHED, sin resultados). */
  savePublished(data: PublishedIncentivePeriodData): Promise<IncentivePeriodRecord>;
  /** Marca el mes como CLOSED con el resultado final congelado. */
  saveClosed(
    period: Period,
    data: { results: unknown; closedAt: Date; closedById: string | null; notes: string | null },
  ): Promise<IncentivePeriodRecord>;
}

// ───────────── Auditoría, procesos y secuencias ─────────────

export interface AuditLogFilter {
  entity: AuditEntity | null;
  entityId: string | null;
  action: AuditAction | null;
  userId: string | null;
  from: Date | null;
  to: Date | null;
}

export interface AuditLogRepository {
  insert(record: AuditRecord): Promise<void>;
  list(filter: AuditLogFilter, page: PageRequest): Promise<Paged<AuditLogRecord>>;
}

export interface JobRunRepository {
  start(job: JobName, at: Date): Promise<string>;
  finish(id: string, status: 'OK' | 'ERROR', at: Date, result: unknown, error: string | null): Promise<void>;
  lastFinished(job: JobName, status: 'OK' | 'ERROR'): Promise<JobRunRecord | null>;
}

export type SequenceName = 'member' | 'membership' | 'movement' | 'lead';

export interface SequenceRepository {
  /** `SELECT nextval('<seq>')`. */
  next(name: SequenceName): Promise<number>;
}

/** Repositorios ligados a una conexión (o a una transacción). */
export interface Repositories {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  plans: PlanRepository;
  categories: CategoryRepository;
  members: MemberRepository;
  memberships: MembershipRepository;
  cash: CashMovementRepository;
  attendances: AttendanceRepository;
  leads: LeadRepository;
  settings: SettingsRepository;
  metrics: MetricsRepository;
  staff: StaffMemberRepository;
  incentives: IncentivesRepository;
  auditLogs: AuditLogRepository;
  jobRuns: JobRunRepository;
  sequences: SequenceRepository;
}
