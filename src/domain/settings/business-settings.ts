import { AttendanceThresholds } from '../attendances/attendance-risk';
import type { IncentiveSettings } from '../incentives/incentive-plan';
import { RenewalWarnDays } from '../members/renewal-status';
import { ErrorDetail, Errors } from '../shared/errors';
import { Period } from '../shared/period';

export type SettingValueType = 'number' | 'string' | 'json' | 'array';

export interface SettingDefinition {
  key: string;
  valueType: SettingValueType;
  group: string;
  label: string;
  defaultValue: unknown;
  /** Validación semántica adicional; devuelve un mensaje si el valor no sirve. */
  validate?: (value: unknown) => string | null;
}

const positiveInt = (v: unknown): string | null =>
  Number.isInteger(v) && (v as number) > 0 ? null : 'Debe ser un entero mayor a 0';
const nonNegativeInt = (v: unknown): string | null =>
  Number.isInteger(v) && (v as number) >= 0 ? null : 'Debe ser un entero mayor o igual a 0';
const nonNegative = (v: unknown): string | null =>
  typeof v === 'number' && v >= 0 ? null : 'Debe ser un número mayor o igual a 0';
const positive = (v: unknown): string | null =>
  typeof v === 'number' && v > 0 ? null : 'Debe ser un número mayor a 0';
const hhmm = (v: unknown): string | null =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : 'Debe tener formato HH:mm';
const period = (v: unknown): string | null => (Period.isValid(v) ? null : 'Debe tener formato AAAA-MM');
const percent = (v: unknown): string | null =>
  typeof v === 'number' && v >= 0 && v <= 100 ? null : 'Debe ser un porcentaje entre 0 y 100 (p. ej. 18)';
const ascendingInts = (n: number) => (v: unknown): string | null =>
  Array.isArray(v) &&
  v.length === n &&
  v.every((x) => Number.isInteger(x) && x > 0) &&
  v.every((x, i) => i === 0 || (x as number) > (v[i - 1] as number))
    ? null
    : `Debe ser una lista de ${n} enteros positivos crecientes`;
const signedPoints = (v: unknown): string | null =>
  typeof v === 'number' && v >= -100 && v <= 100 ? null : 'Debe ser un número entre −100 y 100 (puntos de porcentaje)';
const zeroOrOne = (v: unknown): string | null => (v === 0 || v === 1 ? null : 'Debe ser 1 (sí) o 0 (no)');
/** Lista de meses `AAAA-MM` sin repetir (vacía = automático). */
const periodList = (v: unknown): string | null =>
  Array.isArray(v) && v.length <= 24 && v.every((x) => Period.isValid(x)) && new Set(v).size === v.length
    ? null
    : 'Debe ser una lista de meses AAAA-MM sin repetir (hasta 24); vacía = automático';
const nonEmptyString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? null : 'No puede estar vacío';
const timeZone = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return 'Debe ser una zona horaria IANA';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return null;
  } catch {
    return 'Zona horaria desconocida';
  }
};

/** Catálogo de parámetros con las claves exactas de docs/03 §0 y 04 §3.2. */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: 'app.timezone', valueType: 'string', group: 'app', label: 'Zona horaria del negocio', defaultValue: 'America/Argentina/Buenos_Aires', validate: timeZone },
  { key: 'metrics.cutover_period', valueType: 'string', group: 'metrics', label: 'Inicio del sistema nuevo', defaultValue: '2026-11', validate: period },
  { key: 'metrics.renewal_grace_days', valueType: 'number', group: 'metrics', label: 'Días de gracia para renovar', defaultValue: 15, validate: nonNegativeInt },
  { key: 'metrics.days_per_month', valueType: 'number', group: 'metrics', label: 'Días por mes (permanencia)', defaultValue: 30.4375, validate: positive },
  { key: 'metrics.auto_close_time', valueType: 'string', group: 'metrics', label: 'Hora del cierre preliminar', defaultValue: '23:59', validate: hhmm },
  { key: 'metrics.final_close_time', valueType: 'string', group: 'metrics', label: 'Hora del cierre definitivo', defaultValue: '00:05', validate: hhmm },
  { key: 'memberships.default_duration_days', valueType: 'number', group: 'memberships', label: 'Duración sugerida de la cuota (días)', defaultValue: 30, validate: positiveInt },
  { key: 'members.auto_cancel_after_days', valueType: 'number', group: 'members', label: 'Días vencido para la baja automática', defaultValue: 15, validate: positiveInt },
  { key: 'members.auto_cancel_reason', valueType: 'string', group: 'members', label: 'Motivo de la baja automática', defaultValue: 'Baja automática por inactividad', validate: nonEmptyString },
  { key: 'attendance.alert_days', valueType: 'array', group: 'attendance', label: 'Umbrales de inasistencia (días)', defaultValue: [7, 14, 20], validate: ascendingInts(3) },
  { key: 'renewal.warn_days', valueType: 'array', group: 'renewal', label: 'Avisos de vencimiento (días)', defaultValue: [3, 7], validate: ascendingInts(2) },
  { key: 'leads.visible_days', valueType: 'number', group: 'leads', label: 'Días visibles en el tablero de leads', defaultValue: 15, validate: positiveInt },
  { key: 'finance.fixed_costs.services', valueType: 'number', group: 'finance', label: 'Costos fijos: servicios', defaultValue: 250000, validate: nonNegative },
  { key: 'finance.fixed_costs.salaries', valueType: 'number', group: 'finance', label: 'Costos fijos: sueldos', defaultValue: 700000, validate: nonNegative },
  { key: 'finance.fixed_costs.marketing', valueType: 'number', group: 'finance', label: 'Costos fijos: marketing', defaultValue: 100000, validate: nonNegative },
  { key: 'finance.fixed_costs.supplies', valueType: 'number', group: 'finance', label: 'Costos fijos: insumos', defaultValue: 80000, validate: nonNegative },
  { key: 'finance.fixed_costs.maintenance', valueType: 'number', group: 'finance', label: 'Costos fijos: mantenimiento', defaultValue: 60000, validate: nonNegative },
  { key: 'finance.fixed_costs.contingency', valueType: 'number', group: 'finance', label: 'Costos fijos: imprevistos', defaultValue: 120000, validate: nonNegative },
  { key: 'finance.market_rent', valueType: 'number', group: 'finance', label: 'Alquiler de mercado', defaultValue: 1100000, validate: nonNegative },
  { key: 'finance.current_rent', valueType: 'number', group: 'finance', label: 'Alquiler actual', defaultValue: 0, validate: nonNegative },
  { key: 'finance.usd_reference_rate', valueType: 'number', group: 'finance', label: 'Tipo de cambio USD de referencia', defaultValue: 0, validate: nonNegative },
  { key: 'finance.equipment_installment_usd', valueType: 'number', group: 'finance', label: 'Cuota de equipamiento (USD)', defaultValue: 0, validate: nonNegative },
  { key: 'goals.active_members', valueType: 'number', group: 'goals', label: 'Meta de socios activos', defaultValue: 95, validate: nonNegativeInt },
  { key: 'goals.churn_pct', valueType: 'number', group: 'goals', label: 'Meta de churn (%)', defaultValue: 18, validate: percent },
  { key: 'goals.avg_ticket', valueType: 'number', group: 'goals', label: 'Meta de ticket promedio', defaultValue: 43000, validate: nonNegative },
  { key: 'security.max_failed_attempts', valueType: 'number', group: 'security', label: 'Intentos fallidos permitidos', defaultValue: 5, validate: positiveInt },
  { key: 'security.failed_attempts_window_minutes', valueType: 'number', group: 'security', label: 'Ventana de intentos fallidos (minutos)', defaultValue: 15, validate: positiveInt },
  // Objetivos y bonos (Fase 4, docs/03 §8.4). Los flags se guardan como 0/1.
  { key: 'incentives.history_start_period', valueType: 'string', group: 'incentives', label: 'Primer mes que entra en los cálculos', defaultValue: '2026-05', validate: period },
  { key: 'incentives.history_months', valueType: 'number', group: 'incentives', label: 'Meses de historia para el objetivo', defaultValue: 6, validate: positiveInt },
  { key: 'incentives.ticket_months', valueType: 'number', group: 'incentives', label: 'Meses para el cobro promedio', defaultValue: 3, validate: positiveInt },
  { key: 'incentives.new_members_uplift_pct', valueType: 'number', group: 'incentives', label: 'Suba sobre la mediana de altas (%)', defaultValue: 10, validate: percent },
  { key: 'incentives.renewal_rate_uplift_pts', valueType: 'number', group: 'incentives', label: 'Puntos que se suman a la tasa de renovación', defaultValue: 0, validate: signedPoints },
  { key: 'incentives.new_member_bonus_pct', valueType: 'number', group: 'incentives', label: 'Bono por alta (% del cobro promedio de un alta)', defaultValue: 20, validate: percent },
  { key: 'incentives.team_bonus_pct', valueType: 'number', group: 'incentives', label: 'Bono de equipo (% de lo que entra por renovaciones)', defaultValue: 2, validate: percent },
  { key: 'incentives.rounding_ars', valueType: 'number', group: 'incentives', label: 'Redondeo de los bonos ($)', defaultValue: 500, validate: positiveInt },
  { key: 'incentives.bonus_cap_ars', valueType: 'number', group: 'incentives', label: 'Tope mensual de bonos ($, 0 = sin tope)', defaultValue: 0, validate: nonNegative },
  { key: 'incentives.expense_reference_periods', valueType: 'array', group: 'incentives', label: 'Meses fijos para el gasto de referencia (vacío = automático)', defaultValue: [], validate: periodList },
  { key: 'incentives.expense_reference_months', valueType: 'number', group: 'incentives', label: 'Meses completos que promedia el gasto de referencia', defaultValue: 2, validate: positiveInt },
  { key: 'incentives.target_covers_costs', valueType: 'number', group: 'incentives', label: 'El objetivo cubre gastos y bonos (1 = sí, 0 = no)', defaultValue: 1, validate: zeroOrOne },
];

const DEFINITIONS_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return DEFINITIONS_BY_KEY.get(key);
}

export const FIXED_COST_KEYS = ['services', 'salaries', 'marketing', 'supplies', 'maintenance', 'contingency'] as const;
export type FixedCostKey = (typeof FIXED_COST_KEYS)[number];

/** Convierte valores guardados como texto ("15") al tipo esperado. */
function coerce(value: unknown, type: SettingValueType): unknown {
  if (type === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (type === 'array' && typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      return value;
    }
  }
  return value;
}

/** Valida tipo y semántica de un valor para PATCH /settings. Devuelve el valor normalizado. */
export function validateSettingValue(key: string, valueType: SettingValueType, value: unknown): unknown {
  const details: ErrorDetail[] = [];
  const typeOk =
    (valueType === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (valueType === 'string' && typeof value === 'string') ||
    (valueType === 'array' && Array.isArray(value)) ||
    (valueType === 'json' && value !== undefined);
  if (!typeOk) {
    details.push({ field: `values.${key}`, message: `Debe ser de tipo ${valueType}`, value });
  } else {
    const def = settingDefinition(key);
    const problem = def?.validate?.(value) ?? null;
    if (problem) details.push({ field: `values.${key}`, message: problem, value });
  }
  if (details.length > 0) throw Errors.validation('Parámetro inválido', details);
  return valueType === 'string' ? (value as string).trim() : value;
}

/**
 * Lectura tipada de `settings`. Si una clave falta o tiene un valor inválido se usa el default
 * del catálogo, para que un parámetro mal cargado no rompa los procesos automáticos.
 */
export class BusinessSettings {
  private readonly values = new Map<string, unknown>();

  constructor(raw: ReadonlyMap<string, unknown> | Record<string, unknown>) {
    const entries = raw instanceof Map ? [...raw.entries()] : Object.entries(raw);
    for (const [k, v] of entries) this.values.set(k, v);
  }

  private read<T>(key: string): T {
    const def = DEFINITIONS_BY_KEY.get(key);
    if (!def) throw new Error(`Parámetro desconocido: ${key}`);
    if (!this.values.has(key)) return def.defaultValue as T;
    const v = coerce(this.values.get(key), def.valueType);
    const typeOk =
      (def.valueType === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
      (def.valueType === 'string' && typeof v === 'string') ||
      (def.valueType === 'array' && Array.isArray(v)) ||
      def.valueType === 'json';
    if (!typeOk || (def.validate && def.validate(v) !== null)) return def.defaultValue as T;
    return v as T;
  }

  get timeZone(): string {
    return this.read<string>('app.timezone');
  }
  get cutoverPeriod(): Period {
    return this.read<string>('metrics.cutover_period') as Period;
  }
  get renewalGraceDays(): number {
    return this.read<number>('metrics.renewal_grace_days');
  }
  get daysPerMonth(): number {
    return this.read<number>('metrics.days_per_month');
  }
  get autoCloseTime(): string {
    return this.read<string>('metrics.auto_close_time');
  }
  get finalCloseTime(): string {
    return this.read<string>('metrics.final_close_time');
  }
  get defaultMembershipDays(): number {
    return this.read<number>('memberships.default_duration_days');
  }
  get autoCancelAfterDays(): number {
    return this.read<number>('members.auto_cancel_after_days');
  }
  get autoCancelReason(): string {
    return this.read<string>('members.auto_cancel_reason');
  }
  get attendanceThresholds(): AttendanceThresholds {
    const [medium, high, critical] = this.read<number[]>('attendance.alert_days');
    return { medium: medium!, high: high!, critical: critical! };
  }
  get attendanceAlertDays(): number[] {
    return [...this.read<number[]>('attendance.alert_days')];
  }
  get renewalWarnDays(): RenewalWarnDays {
    const [due3d, due7d] = this.read<number[]>('renewal.warn_days');
    return { due3d: due3d!, due7d: due7d! };
  }
  get leadsVisibleDays(): number {
    return this.read<number>('leads.visible_days');
  }
  get fixedCosts(): Record<FixedCostKey, number> {
    const out = {} as Record<FixedCostKey, number>;
    for (const k of FIXED_COST_KEYS) out[k] = this.read<number>(`finance.fixed_costs.${k}`);
    return out;
  }
  get marketRent(): number {
    return this.read<number>('finance.market_rent');
  }
  get goals(): { activeMembers: number; churnPct: number; avgTicket: number } {
    return {
      activeMembers: this.read<number>('goals.active_members'),
      churnPct: this.read<number>('goals.churn_pct'),
      avgTicket: this.read<number>('goals.avg_ticket'),
    };
  }
  /** Parámetros de objetivos y bonos (docs/03 §8.4). */
  get incentives(): IncentiveSettings {
    return {
      historyStartPeriod: this.read<string>('incentives.history_start_period') as Period,
      historyMonths: this.read<number>('incentives.history_months'),
      ticketMonths: this.read<number>('incentives.ticket_months'),
      newMembersUpliftPct: this.read<number>('incentives.new_members_uplift_pct'),
      renewalRateUpliftPts: this.read<number>('incentives.renewal_rate_uplift_pts'),
      newMemberBonusPct: this.read<number>('incentives.new_member_bonus_pct'),
      teamBonusPct: this.read<number>('incentives.team_bonus_pct'),
      roundingArs: this.read<number>('incentives.rounding_ars'),
      bonusCapArs: this.read<number>('incentives.bonus_cap_ars'),
      expenseReferencePeriods: [...new Set(this.read<string[]>('incentives.expense_reference_periods'))].sort() as Period[],
      expenseReferenceMonths: this.read<number>('incentives.expense_reference_months'),
      targetCoversCosts: this.read<number>('incentives.target_covers_costs') === 1,
    };
  }
  get maxFailedAttempts(): number {
    return this.read<number>('security.max_failed_attempts');
  }
  get failedAttemptsWindowMinutes(): number {
    return this.read<number>('security.failed_attempts_window_minutes');
  }
}
