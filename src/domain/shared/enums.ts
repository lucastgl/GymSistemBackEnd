/**
 * Enumeraciones del dominio. Replican los enums de docs/04 §2 y prisma/schema.prisma
 * sin depender de @prisma/client (la infraestructura mapea por identidad de string).
 */
export const ROLES = ['ADMIN', 'RECEPCIONISTA', 'NUTRICIONISTA', 'ALUMNO'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_STATUS_EVENT_TYPES = ['ACTIVATED', 'CANCELLED', 'REACTIVATED', 'AUTO_CANCELLED'] as const;
export type MemberStatusEventType = (typeof MEMBER_STATUS_EVENT_TYPES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const MOVEMENT_TYPES = ['INCOME', 'EXPENSE'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_ORIGINS = ['MANUAL', 'RENEWAL', 'IMPORT'] as const;
export type MovementOrigin = (typeof MOVEMENT_ORIGINS)[number];

export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'MERCADOPAGO', 'DEBIT', 'CREDIT', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ATTENDANCE_SOURCES = ['WEB', 'MANUAL'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const LEAD_STAGES = [
  'FIRST_MESSAGE',
  'SECOND_MESSAGE',
  'TRIAL_ATTENDED',
  'SIGNED_UP',
  'LOST',
  'NOT_INTERESTED',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_CHANNELS = ['WALK_IN', 'WHATSAPP', 'SOCIAL_MEDIA', 'REFERRAL', 'OTHER'] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const NUTRITION_BILLINGS = ['GYM', 'NUTRITIONIST'] as const;
export type NutritionBilling = (typeof NUTRITION_BILLINGS)[number];

export const METHODOLOGY_VERSIONS = ['LEGACY_V3_7', 'V1'] as const;
export type MethodologyVersion = (typeof METHODOLOGY_VERSIONS)[number];

export const METRIC_SOURCES = ['SNAPSHOT', 'LIVE'] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export const SNAPSHOT_SOURCES = ['IMPORT', 'AUTO', 'MANUAL'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const SNAPSHOT_STAGES = ['PRELIMINARY', 'FINAL', 'REFERENCE'] as const;
export type SnapshotStage = (typeof SNAPSHOT_STAGES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'VOID',
  'DELETE',
  'CANCEL',
  'REACTIVATE',
  'LOGIN',
  'PASSWORD_CHANGE',
  'CLOSE_PERIOD',
  'PUBLISH',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITIES = [
  'USER',
  'PLAN',
  'MEMBER',
  'MEMBERSHIP',
  'CASH_MOVEMENT',
  'CASH_CATEGORY',
  'ATTENDANCE',
  'LEAD',
  'SETTING',
  'METRIC_SNAPSHOT',
  'STAFF_MEMBER',
  'INCENTIVE_PERIOD',
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Estado de un mes de objetivos y bonos. DRAFT existe solo en la API (mes sin publicar). */
export const INCENTIVE_PERIOD_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export type IncentivePeriodStatus = (typeof INCENTIVE_PERIOD_STATUSES)[number];
/** Lo que se guarda en `incentive_periods.status` (sin DRAFT). */
export type StoredIncentivePeriodStatus = Exclude<IncentivePeriodStatus, 'DRAFT'>;

/** Advertencias de la fórmula de objetivos y bonos (docs/03 §8, docs/05 IncentiveWarningCode). */
export const INCENTIVE_WARNING_CODES = [
  'NO_HISTORY',
  'FEW_HISTORY_MONTHS',
  'PROVISIONAL_RENEWAL_DATA',
  'NO_RENEWAL_RATE',
  'EXPENSES_NOT_AVAILABLE',
  'COST_STRUCTURE_CHANGED',
  'TARGET_RAISED_TO_BREAKEVEN',
  'TARGET_ABOVE_HISTORY',
  'RESULT_NEGATIVE',
  'NO_ELIGIBLE_STAFF',
  'DATA_GAP_PREVIOUS_MONTH',
  'UNASSIGNED_NEW_MEMBERS',
  'CAP_APPLIED',
] as const;
export type IncentiveWarningCode = (typeof INCENTIVE_WARNING_CODES)[number];

export const RENEWAL_STATUSES = ['OK', 'DUE_7D', 'DUE_3D', 'DUE_TODAY', 'EXPIRED', 'UNKNOWN', 'CANCELLED'] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const ATTENDANCE_RISKS = ['OK', 'MEDIUM', 'HIGH', 'CRITICAL', 'NO_ATTENDANCE'] as const;
export type AttendanceRisk = (typeof ATTENDANCE_RISKS)[number];

export const WHATSAPP_TEMPLATES = [
  'vencimiento',
  'reactivacion',
  'ausente',
  'inasistencia_alta',
  'inasistencia_critica',
] as const;
export type WhatsappTemplate = (typeof WHATSAPP_TEMPLATES)[number];

export const JOB_NAMES = [
  'AUTO_CANCEL_MEMBERS',
  'CLOSE_PERIOD_PRELIMINARY',
  'CLOSE_PERIOD_FINAL',
  'CLOSE_PERIOD_CATCHUP',
] as const;
export type JobName = (typeof JOB_NAMES)[number];
