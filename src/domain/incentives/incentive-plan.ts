import { StaffRef } from '../repositories/records';
import { DateOnly } from '../shared/date-only';
import { IncentiveWarningCode } from '../shared/enums';
import { round2 } from '../shared/money';
import { Period } from '../shared/period';
import { foldText } from '../shared/text';

/**
 * Objetivos y bonos del equipo · Fórmula v1 (docs/03 §8, plan Fase 4 reglas 1–17).
 * Funciones puras: el planificador de la aplicación junta los datos y acá se hacen todas las
 * cuentas. El front nunca calcula.
 */

export const FORMULA_VERSION = '1';
/** Subcategoría con la que se registran los bonos en Caja: no cuenta en el gasto de referencia. */
export const BONUS_SUBCATEGORY = 'Bonos';
/** Un mes tiene los gastos completos si tiene al menos un egreso en cada una (regla 7). */
export const COMPLETE_EXPENSE_CATEGORIES = ['Alquiler', 'Sueldos y liquidaciones'] as const;
/** COST_STRUCTURE_CHANGED: el último mes completo supera la referencia en más de este %. */
export const COST_STRUCTURE_THRESHOLD_PCT = 10;
/** DATA_GAP_PREVIOUS_MONTH: el último cobro del mes anterior es anterior a su último día − N. */
export const DATA_GAP_DAYS = 3;

// ───────────── Tipos de entrada ─────────────

/** Parámetros `incentives.*` ya tipados (BusinessSettings.incentives). */
export interface IncentiveSettings {
  historyStartPeriod: Period;
  historyMonths: number;
  ticketMonths: number;
  newMembersUpliftPct: number;
  renewalRateUpliftPts: number;
  newMemberBonusPct: number;
  teamBonusPct: number;
  roundingArs: number;
  bonusCapArs: number;
  expenseReferencePeriods: Period[];
  expenseReferenceMonths: number;
  targetCoversCosts: boolean;
}

/** Reemplazos del simulador (docs/05 IncentiveOverrides). Lo que no viene sale de los parámetros. */
export interface IncentiveOverrides {
  newMembersUpliftPct?: number;
  renewalRateUpliftPts?: number;
  newMemberBonusPct?: number;
  teamBonusPct?: number;
  expenseReferenceArs?: number;
  newMembersTarget?: number;
  renewalRateTargetPct?: number;
  bonusPerNewMemberArs?: number;
  teamBonusPerPersonArs?: number;
}

export const OVERRIDE_KEYS = [
  'newMembersUpliftPct',
  'renewalRateUpliftPts',
  'newMemberBonusPct',
  'teamBonusPct',
  'expenseReferenceArs',
  'newMembersTarget',
  'renewalRateTargetPct',
  'bonusPerNewMemberArs',
  'teamBonusPerPersonArs',
] as const satisfies readonly (keyof IncentiveOverrides)[];

/** Egresos de un mes agrupados por categoría y subcategoría. */
export interface ExpenseGroup {
  categoryName: string;
  subcategory: string | null;
  amount: number;
  count: number;
}

/** Hechos de un mes ya resumidos (los arma el planificador). */
export interface IncentiveMonthFacts {
  period: Period;
  /** Altas con cobro (regla 1) y lo que pagaron. */
  newMembers: number;
  newMembersAmount: number;
  /** Pagos del mes que no son alta. */
  renewalPayments: number;
  renewalPaymentsAmount: number;
  /** Vencimientos del mes y cuántos renovaron (lógica V1); null si no hay datos previos. */
  expirations: number | null;
  renewed: number | null;
  /** Ya venció la gracia: la tasa del mes no cambia más. */
  renewalIsFinal: boolean;
  otherIncome: number;
  /** Egresos sin la subcategoría "Bonos" (base del gasto de referencia). */
  expenses: number;
  expensesComplete: boolean;
}

export interface IncentivePlanInput {
  period: Period;
  today: DateOnly;
  generatedAt: string;
  /** Primer mes con pagos o movimientos (abril 2026); null si la base está vacía. */
  firstDataPeriod: Period | null;
  /** Hechos de los meses anteriores a P (los que falten se toman como meses sin datos). */
  months: readonly IncentiveMonthFacts[];
  /** Coberturas que vencen en P. */
  expectedExpirations: number;
  /** Personas activas que cobran bono (E). */
  eligibleStaff: readonly StaffRef[];
  settings: IncentiveSettings;
  renewalGraceDays: number;
  overrides?: IncentiveOverrides;
  /** Altas con cobro de P sin "Vendido por". */
  unassignedNewMembers?: number;
  /** Último cobro registrado en P − 1 (DATA_GAP_PREVIOUS_MONTH). */
  previousMonthLastPaymentOn?: DateOnly | null;
}

// ───────────── Tipos de salida (docs/05) ─────────────

export interface IncentiveWarning {
  code: IncentiveWarningCode;
  severity: 'info' | 'warning';
  message: string;
}

export type ExpenseReferenceSource = 'AUTO' | 'SETTING' | 'OVERRIDE' | 'NONE';
export type NewMembersTargetSource = 'STATISTICAL' | 'BREAKEVEN' | 'OVERRIDE';

export interface IncentivePlan {
  period: string;
  formulaVersion: string;
  generatedAt: string;
  window: {
    periods: string[];
    renewalRatePeriods: string[];
    ticketPeriods: string[];
    expenseReferencePeriods: string[];
  };
  inputs: {
    newMembersByPeriod: { period: string; count: number }[];
    newMembersMedian: number | null;
    renewalRateHistPct: number | null;
    expectedExpirations: number;
    extraRenewalPayments: number;
    ticketNewMember: number | null;
    ticketRenewal: number | null;
    otherIncome: number;
    expenseReferenceArs: number | null;
    expenseReferenceSource: ExpenseReferenceSource;
    lastCompleteMonthExpenses: number | null;
    eligibleStaff: StaffRef[];
  };
  targets: {
    newMembersStatistical: number;
    newMembersBreakeven: number | null;
    newMembers: number;
    newMembersSource: NewMembersTargetSource;
    newMembersAchievedMonths: number;
    renewalRateTargetPct: number;
    renewals: number;
    renewalRateAchievedMonths: number;
  };
  amounts: {
    bonusPerNewMemberArs: number;
    teamBonusPerPersonArs: number;
    teamBonusTotalArs: number;
    newMemberBonusesAtTargetArs: number;
    totalAtTargetArs: number;
    capArs: number | null;
  };
  projection: {
    incomeNewMembers: number;
    incomeRenewals: number;
    incomeExtraRenewals: number;
    incomeOther: number;
    incomeTotal: number;
    expenses: number | null;
    bonuses: number;
    resultBeforeBonuses: number | null;
    resultAfterBonuses: number | null;
    breakevenPayments: number | null;
  };
  settings: Record<string, unknown>;
  overrides: IncentiveOverrides;
  warnings: IncentiveWarning[];
  acceptedNegativeResult: boolean;
}

export interface IncentiveNewMember {
  memberId: string;
  legacyCode: string;
  fullName: string;
  paidOn: string;
  amount: number;
  planName: string;
  soldBy: StaffRef | null;
}

export interface IncentiveStaffResult {
  staff: StaffRef;
  isBonusEligible: boolean;
  newMembers: number;
  newMemberBonusArs: number;
  teamBonusArs: number;
  totalArs: number;
}

export interface IncentiveProgress {
  asOf: string;
  isFinal: boolean;
  newMembers: { actual: number; target: number; remaining: number; achieved: boolean; unassigned: number };
  renewals: {
    expirations: number;
    renewed: number;
    pending: number;
    lost: number;
    ratePct: number | null;
    targetRatePct: number;
    required: number;
    achieved: boolean;
    graceEndsOn: string;
  };
  staff: IncentiveStaffResult[];
  totals: { newMemberBonusesArs: number; teamBonusesArs: number; totalArs: number; capApplied: boolean };
  finance: { incomeToDate: number; expensesToDate: number };
  newMembersList: IncentiveNewMember[];
}

// ───────────── Utilidades ─────────────

const EPS = 1e-9;

/** ceil tolerante a errores de punto flotante (10 × 1,1 = 11,000000000000002 → 11). */
function ceilSafe(value: number): number {
  const r = Math.ceil(value - EPS);
  return r === 0 ? 0 : r; // sin −0 (ceil(−1e-9) = −0)
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Mediana; con cantidad par, promedio de los dos centrales. null si no hay valores. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Redondeo al múltiplo más cercano de `step` (medio para arriba):
 * 22.755,5 → 23.000 · 13.853 → 14.000 · 22.724 → 22.500 (con step 500).
 */
export function roundTo(value: number, step: number): number {
  if (!(step > 0)) return round2(value);
  return round2(Math.floor(value / step + 0.5 + EPS) * step);
}

/** Múltiplo de `step` inmediatamente inferior (prorrateo por tope: nunca lo supera). */
function floorTo(value: number, step: number): number {
  if (!(step > 0)) return Math.floor(value + EPS);
  return round2(Math.floor(value / step + EPS) * step);
}

/** Cobro promedio redondeado a peso entero; null sin cobros. */
function ticket(amount: number, count: number): number | null {
  return count > 0 ? Math.round(amount / count + EPS) : null;
}

export function isBonusSubcategory(subcategory: string | null | undefined): boolean {
  return foldText(subcategory) === foldText(BONUS_SUBCATEGORY);
}

/**
 * Mes con gastos completos (regla 7): al menos un egreso en "Alquiler" y uno en "Sueldos y
 * liquidaciones". Los bonos no cuentan como liquidación.
 */
export function isExpensesComplete(groups: readonly ExpenseGroup[]): boolean {
  return COMPLETE_EXPENSE_CATEGORIES.every((name) =>
    groups.some((g) => g.count > 0 && foldText(g.categoryName) === foldText(name) && !isBonusSubcategory(g.subcategory)),
  );
}

/** Total de egresos, total sin "Bonos" (base de la referencia) y si el mes está completo. */
export function summarizeExpenses(groups: readonly ExpenseGroup[]): { total: number; reference: number; complete: boolean } {
  return {
    total: round2(sum(groups.map((g) => g.amount))),
    reference: round2(sum(groups.filter((g) => !isBonusSubcategory(g.subcategory)).map((g) => g.amount))),
    complete: isExpensesComplete(groups),
  };
}

/**
 * Meses que la fórmula puede usar para P: cerrados (anteriores a P y al mes en curso), desde
 * `historyStartPeriod` (abril 2026 tiene la carga inicial) y desde el primer mes con datos.
 * `upper` es exclusivo. null si no hay datos.
 */
export function historyBounds(
  period: Period,
  settings: IncentiveSettings,
  firstDataPeriod: Period | null,
  today: DateOnly,
): { lower: Period; upper: Period } | null {
  if (firstDataPeriod === null) return null;
  const lower = settings.historyStartPeriod > firstDataPeriod ? settings.historyStartPeriod : firstDataPeriod;
  const current = Period.ofDate(today);
  return { lower, upper: period < current ? period : current };
}

/** Ventana W: los últimos `historyMonths` meses cerrados antes de P (ver `historyBounds`). */
export function incentiveWindow(
  period: Period,
  settings: IncentiveSettings,
  firstDataPeriod: Period | null,
  today: DateOnly,
): Period[] {
  const bounds = historyBounds(period, settings, firstDataPeriod, today);
  if (!bounds) return [];
  const out: Period[] = [];
  let p = Period.previous(bounds.upper);
  while (out.length < settings.historyMonths && p >= bounds.lower) {
    out.unshift(p);
    p = Period.previous(p);
  }
  return out;
}

/**
 * Meses del gasto de referencia (regla 7): los de `expense_reference_periods` anteriores a P si
 * hay; si no, los últimos `expense_reference_months` meses cerrados con gastos completos.
 */
export function pickExpenseReferencePeriods(
  period: Period,
  months: readonly IncentiveMonthFacts[],
  settings: IncentiveSettings,
  firstDataPeriod: Period | null,
  today: DateOnly,
): { periods: Period[]; source: 'SETTING' | 'AUTO' | 'NONE' } {
  const configured = [...new Set(settings.expenseReferencePeriods)].filter((p) => p < period).sort();
  if (configured.length > 0) return { periods: configured, source: 'SETTING' };
  const complete = completeClosedMonths(period, months, settings, firstDataPeriod, today)
    .slice(0, settings.expenseReferenceMonths)
    .map((m) => m.period)
    .sort();
  return complete.length > 0 ? { periods: complete, source: 'AUTO' } : { periods: [], source: 'NONE' };
}

/** Meses cerrados con gastos completos que la fórmula puede usar para P, del más reciente al más viejo. */
function completeClosedMonths(
  period: Period,
  months: readonly IncentiveMonthFacts[],
  settings: IncentiveSettings,
  firstDataPeriod: Period | null,
  today: DateOnly,
): IncentiveMonthFacts[] {
  const bounds = historyBounds(period, settings, firstDataPeriod, today);
  if (!bounds) return [];
  return months
    .filter((m) => m.period >= bounds.lower && m.period < bounds.upper && m.expensesComplete)
    .sort((a, b) => (a.period < b.period ? 1 : -1));
}

function emptyMonth(period: Period): IncentiveMonthFacts {
  return {
    period,
    newMembers: 0,
    newMembersAmount: 0,
    renewalPayments: 0,
    renewalPaymentsAmount: 0,
    expirations: null,
    renewed: null,
    renewalIsFinal: false,
    otherIncome: 0,
    expenses: 0,
    expensesComplete: false,
  };
}

// ───────────── Textos de las advertencias ─────────────

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ARS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function monthName(p: Period, refYear: number): string {
  const name = MONTHS_ES[Period.month(p) - 1]!;
  return Period.year(p) === refYear ? name : `${name} ${Period.year(p)}`;
}

function monthList(periods: readonly Period[], refYear: number): string {
  const names = periods.map((p) => monthName(p, refYear));
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function ars(value: number): string {
  return `$${ARS.format(value)}`;
}

function dayMonth(d: DateOnly): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ───────────── Fórmula v1 ─────────────

/** Propuesta de objetivo y bonos del mes P (reglas 2–15). No guarda nada. */
export function computeIncentivePlan(input: IncentivePlanInput): IncentivePlan {
  const { period, settings: base } = input;
  const ov: IncentiveOverrides = {};
  for (const k of OVERRIDE_KEYS) if (input.overrides?.[k] !== undefined && input.overrides[k] !== null) ov[k] = input.overrides[k];
  const pct = {
    newMembersUplift: ov.newMembersUpliftPct ?? base.newMembersUpliftPct,
    renewalRateUplift: ov.renewalRateUpliftPts ?? base.renewalRateUpliftPts,
    newMemberBonus: ov.newMemberBonusPct ?? base.newMemberBonusPct,
    teamBonus: ov.teamBonusPct ?? base.teamBonusPct,
  };
  const refYear = Period.year(period);
  const byPeriod = new Map(input.months.map((m) => [m.period, m]));
  const factsOf = (p: Period): IncentiveMonthFacts => byPeriod.get(p) ?? emptyMonth(p);
  const warnings: IncentiveWarning[] = [];
  const warn = (code: IncentiveWarningCode, severity: IncentiveWarning['severity'], message: string): void => {
    warnings.push({ code, severity, message });
  };

  // Ventana W y sus submuestras.
  const windowPeriods = incentiveWindow(period, base, input.firstDataPeriod, input.today);
  const W = windowPeriods.map(factsOf);
  const rateMonths = W.filter((m) => m.renewalIsFinal && m.expirations !== null && m.renewed !== null);
  const graceOpenMonths = W.filter((m) => !m.renewalIsFinal && m.expirations !== null);
  const ticketMonths = W.slice(-Math.max(1, base.ticketMonths));

  // Regla 2 · objetivo estadístico de altas.
  const newMembersMedian = median(W.map((m) => m.newMembers));
  const newMembersStatistical =
    newMembersMedian === null ? 0 : ceilSafe((newMembersMedian * (100 + pct.newMembersUplift)) / 100);

  // Regla 3–4 · tasa de renovación congelada con 2 decimales y mínimo de renovaciones.
  const sumExpirations = sum(rateMonths.map((m) => m.expirations!));
  const sumRenewed = sum(rateMonths.map((m) => m.renewed!));
  const renewalRateHistPct = sumExpirations > 0 ? round4((sumRenewed * 100) / sumExpirations) : null;
  const renewalRateTargetPct =
    ov.renewalRateTargetPct !== undefined
      ? round2(clamp(ov.renewalRateTargetPct, 0, 100))
      : round2(clamp((renewalRateHistPct ?? 0) + pct.renewalRateUplift, 0, 100));
  const expectedExpirations = Math.max(0, Math.trunc(input.expectedExpirations));
  const renewalsTarget = ceilSafe((expectedExpirations * renewalRateTargetPct) / 100);
  const renewalRateAchievedMonths = rateMonths.filter(
    (m) => m.expirations! > 0 && (m.renewed! * 100) / m.expirations! >= renewalRateTargetPct - EPS,
  ).length;

  // Regla 5 · pagos extra (reactivaciones y atrasados): solo meses con la gracia vencida.
  const extraMedian = median(rateMonths.map((m) => m.renewalPayments - m.renewed!));
  const extraRenewalPayments = extraMedian === null ? 0 : Math.max(0, Math.floor(extraMedian + EPS));

  // Regla 6 · cobros promedio (a peso entero) y otros ingresos.
  const ticketNewMember = ticket(sum(ticketMonths.map((m) => m.newMembersAmount)), sum(ticketMonths.map((m) => m.newMembers)));
  const ticketRenewal = ticket(
    sum(ticketMonths.map((m) => m.renewalPaymentsAmount)),
    sum(ticketMonths.map((m) => m.renewalPayments)),
  );
  const otherIncome = round2(median(W.map((m) => m.otherIncome)) ?? 0);

  // Regla 7 · gasto de referencia.
  const picked = pickExpenseReferencePeriods(period, input.months, base, input.firstDataPeriod, input.today);
  let expenseReferenceArs: number | null;
  let expenseReferenceSource: ExpenseReferenceSource;
  let expenseReferencePeriods: Period[];
  if (ov.expenseReferenceArs !== undefined) {
    expenseReferenceArs = round2(ov.expenseReferenceArs);
    expenseReferenceSource = 'OVERRIDE';
    expenseReferencePeriods = [];
  } else if (picked.source !== 'NONE') {
    expenseReferenceArs = round2(sum(picked.periods.map((p) => factsOf(p).expenses)) / picked.periods.length);
    expenseReferenceSource = picked.source;
    expenseReferencePeriods = picked.periods;
  } else {
    expenseReferenceArs = null;
    expenseReferenceSource = 'NONE';
    expenseReferencePeriods = [];
  }
  const lastComplete = completeClosedMonths(period, input.months, base, input.firstDataPeriod, input.today)[0] ?? null;
  const lastCompleteMonthExpenses = lastComplete ? lastComplete.expenses : null;

  // Reglas 8–9 · montos.
  const eligibleStaff = input.eligibleStaff.map((s) => ({ id: s.id, displayName: s.displayName }));
  const E = eligibleStaff.length;
  let bonusPerNewMemberArs =
    ov.bonusPerNewMemberArs !== undefined
      ? round2(ov.bonusPerNewMemberArs)
      : ticketNewMember === null
        ? 0
        : roundTo((ticketNewMember * pct.newMemberBonus) / 100, base.roundingArs);
  let teamBonusPerPersonArs =
    ov.teamBonusPerPersonArs !== undefined
      ? round2(ov.teamBonusPerPersonArs)
      : E === 0 || ticketRenewal === null
        ? 0
        : roundTo((renewalsTarget * ticketRenewal * pct.teamBonus) / (100 * E), base.roundingArs);
  let teamBonusTotalArs = round2(teamBonusPerPersonArs * E);

  // Reglas 10–11 · ingreso fijo y equilibrio.
  const fixedIncome = round2((renewalsTarget + extraRenewalPayments) * (ticketRenewal ?? 0) + otherIncome);
  let newMembersBreakeven: number | null = null;
  if (expenseReferenceArs !== null) {
    const needed = expenseReferenceArs + teamBonusTotalArs - fixedIncome;
    const marginPerNewMember = (ticketNewMember ?? 0) - bonusPerNewMemberArs;
    if (needed <= 0) newMembersBreakeven = 0;
    else if (marginPerNewMember > 0) newMembersBreakeven = Math.max(0, ceilSafe(needed / marginPerNewMember));
  }

  // Regla 12 · objetivo final.
  let newMembersTarget: number;
  let newMembersSource: NewMembersTargetSource;
  if (ov.newMembersTarget !== undefined) {
    newMembersTarget = Math.max(0, Math.trunc(ov.newMembersTarget));
    newMembersSource = 'OVERRIDE';
  } else if (base.targetCoversCosts && newMembersBreakeven !== null && newMembersBreakeven > newMembersStatistical) {
    newMembersTarget = newMembersBreakeven;
    newMembersSource = 'BREAKEVEN';
  } else {
    newMembersTarget = newMembersStatistical;
    newMembersSource = 'STATISTICAL';
  }
  const newMembersAchievedMonths = W.filter((m) => m.newMembers >= newMembersTarget).length;

  // Regla 14 · tope mensual de bonos (los montos se prorratean para no pasarlo).
  const capArs = base.bonusCapArs > 0 ? round2(base.bonusCapArs) : null;
  let newMemberBonusesAtTargetArs = round2(newMembersTarget * bonusPerNewMemberArs);
  let totalAtTargetArs = round2(newMemberBonusesAtTargetArs + teamBonusTotalArs);
  const totalBeforeCap = totalAtTargetArs;
  if (capArs !== null && totalAtTargetArs > capArs) {
    const factor = capArs / totalAtTargetArs;
    bonusPerNewMemberArs = floorTo(bonusPerNewMemberArs * factor, base.roundingArs);
    teamBonusPerPersonArs = floorTo(teamBonusPerPersonArs * factor, base.roundingArs);
    teamBonusTotalArs = round2(teamBonusPerPersonArs * E);
    newMemberBonusesAtTargetArs = round2(newMembersTarget * bonusPerNewMemberArs);
    totalAtTargetArs = round2(newMemberBonusesAtTargetArs + teamBonusTotalArs);
  }

  // Regla 13 · proyección al objetivo.
  const incomeNewMembers = round2(newMembersTarget * (ticketNewMember ?? 0));
  const incomeRenewals = round2(renewalsTarget * (ticketRenewal ?? 0));
  const incomeExtraRenewals = round2(extraRenewalPayments * (ticketRenewal ?? 0));
  const paymentsIncome = incomeNewMembers + incomeRenewals + incomeExtraRenewals;
  const incomeTotal = round2(paymentsIncome + otherIncome);
  const resultBeforeBonuses = expenseReferenceArs === null ? null : round2(incomeTotal - expenseReferenceArs);
  const resultAfterBonuses = resultBeforeBonuses === null ? null : round2(resultBeforeBonuses - totalAtTargetArs);
  // Cobros del mes para resultado 0 sin bonos (definición del coordinador): renovaciones y extra
  // proyectadas + las altas que faltan para cubrir el gasto con el ingreso fijo. Caso B: 77 + 8 = 85.
  const uncovered = expenseReferenceArs === null ? null : expenseReferenceArs - fixedIncome;
  const newMembersWithoutBonuses =
    uncovered === null ? null : uncovered <= 0 ? 0 : ticketNewMember && ticketNewMember > 0 ? ceilSafe(uncovered / ticketNewMember) : null;
  const breakevenPayments =
    newMembersWithoutBonuses === null ? null : renewalsTarget + extraRenewalPayments + newMembersWithoutBonuses;

  // Regla 15 · advertencias.
  if (W.length === 0) {
    warn('NO_HISTORY', 'warning', 'Todavía no hay meses cerrados con datos para calcular el objetivo. Definilo a mano en el simulador.');
  } else if (W.length < base.historyMonths) {
    warn(
      'FEW_HISTORY_MONTHS',
      'info',
      `El objetivo sale de solo ${plural(W.length, 'mes', 'meses')} de historia (lo ideal son ${base.historyMonths}). Tomalo como orientativo.`,
    );
  }
  if (renewalRateHistPct === null) {
    if (ov.renewalRateTargetPct === undefined) {
      warn(
        'NO_RENEWAL_RATE',
        'warning',
        'No hay meses con la gracia vencida para calcular la tasa de renovación. Cargá la tasa a mano en el simulador.',
      );
    }
  } else if (graceOpenMonths.length > 0) {
    warn(
      'PROVISIONAL_RENEWAL_DATA',
      'info',
      `La tasa de renovación no incluye ${monthList(
        graceOpenMonths.map((m) => m.period),
        refYear,
      )}: todavía corren los ${input.renewalGraceDays} días de gracia para renovar.`,
    );
  }
  if (expenseReferenceArs === null) {
    warn(
      'EXPENSES_NOT_AVAILABLE',
      'warning',
      'No hay meses con los gastos completos (alquiler y sueldos cargados en Caja) para usar de referencia. Cargá el gasto del mes en el simulador.',
    );
  } else if (
    lastComplete !== null &&
    lastCompleteMonthExpenses !== null &&
    lastCompleteMonthExpenses > expenseReferenceArs * (1 + COST_STRUCTURE_THRESHOLD_PCT / 100) + EPS
  ) {
    warn(
      'COST_STRUCTURE_CHANGED',
      'warning',
      `En ${monthName(lastComplete.period, refYear)} se gastó ${ars(lastCompleteMonthExpenses)}, más de ${COST_STRUCTURE_THRESHOLD_PCT} % arriba de la referencia (${ars(
        expenseReferenceArs,
      )}). Si los gastos subieron para quedarse, ajustá el gasto en el simulador.`,
    );
  }
  if (newMembersSource === 'BREAKEVEN') {
    warn(
      'TARGET_RAISED_TO_BREAKEVEN',
      'info',
      `Con la historia alcanzaban ${newMembersStatistical} altas, pero para cubrir gastos y bonos hacen falta ${newMembersTarget}: el objetivo sube a ${newMembersTarget}.`,
    );
  }
  if (W.length > 0 && newMembersAchievedMonths === 0) {
    warn(
      'TARGET_ABOVE_HISTORY',
      'warning',
      `Ningún mes de los últimos ${W.length} llegó a ${plural(newMembersTarget, 'alta', 'altas')}. Es un objetivo exigente.`,
    );
  }
  if (resultAfterBonuses !== null && resultAfterBonuses < 0) {
    warn(
      'RESULT_NEGATIVE',
      'warning',
      `Aun llegando al objetivo, el mes cerraría con una pérdida de ${ars(-resultAfterBonuses)} después de pagar los bonos. Para publicar hay que confirmarlo.`,
    );
  }
  if (E === 0) {
    warn('NO_ELIGIBLE_STAFF', 'warning', 'No hay personas activas que cobren bono: el bono de equipo queda en $0. Revisalo en la pestaña Equipo.');
  }
  const previous = Period.previous(period);
  if (
    input.previousMonthLastPaymentOn !== undefined &&
    input.firstDataPeriod !== null &&
    previous >= input.firstDataPeriod &&
    Period.last(previous) < input.today
  ) {
    const last = input.previousMonthLastPaymentOn;
    if (last === null) {
      warn(
        'DATA_GAP_PREVIOUS_MONTH',
        'warning',
        `No hay cobros cargados en ${monthName(previous, refYear)}. Si faltan pagos por cargar, los números pueden estar corridos.`,
      );
    } else if (last < DateOnly.addDays(Period.last(previous), -DATA_GAP_DAYS)) {
      warn(
        'DATA_GAP_PREVIOUS_MONTH',
        'warning',
        `El último cobro cargado de ${monthName(previous, refYear)} es del ${dayMonth(last)}. Si faltan pagos por cargar, los números pueden estar corridos.`,
      );
    }
  }
  const unassigned = input.unassignedNewMembers ?? 0;
  if (unassigned > 0) {
    warn(
      'UNASSIGNED_NEW_MEMBERS',
      'warning',
      `Hay ${plural(unassigned, 'alta', 'altas')} de ${monthName(period, refYear)} sin "Vendido por". Asignalas para que cada uno cobre su bono.`,
    );
  }
  if (capArs !== null && totalBeforeCap > capArs) {
    warn('CAP_APPLIED', 'info', `Los bonos al objetivo (${ars(totalBeforeCap)}) pasaban el tope de ${ars(capArs)}: se bajaron en proporción.`);
  }

  return {
    period,
    formulaVersion: FORMULA_VERSION,
    generatedAt: input.generatedAt,
    window: {
      periods: windowPeriods,
      renewalRatePeriods: rateMonths.map((m) => m.period),
      ticketPeriods: ticketMonths.map((m) => m.period),
      expenseReferencePeriods,
    },
    inputs: {
      newMembersByPeriod: W.map((m) => ({ period: m.period, count: m.newMembers })),
      newMembersMedian,
      renewalRateHistPct,
      expectedExpirations,
      extraRenewalPayments,
      ticketNewMember,
      ticketRenewal,
      otherIncome,
      expenseReferenceArs,
      expenseReferenceSource,
      lastCompleteMonthExpenses,
      eligibleStaff,
    },
    targets: {
      newMembersStatistical,
      newMembersBreakeven,
      newMembers: newMembersTarget,
      newMembersSource,
      newMembersAchievedMonths,
      renewalRateTargetPct,
      renewals: renewalsTarget,
      renewalRateAchievedMonths,
    },
    amounts: {
      bonusPerNewMemberArs,
      teamBonusPerPersonArs,
      teamBonusTotalArs,
      newMemberBonusesAtTargetArs,
      totalAtTargetArs,
      capArs,
    },
    projection: {
      incomeNewMembers,
      incomeRenewals,
      incomeExtraRenewals,
      incomeOther: otherIncome,
      incomeTotal,
      expenses: expenseReferenceArs,
      bonuses: totalAtTargetArs,
      resultBeforeBonuses,
      resultAfterBonuses,
      breakevenPayments,
    },
    settings: incentiveSettingsSnapshot(base),
    overrides: ov,
    warnings,
    acceptedNegativeResult: false,
  };
}

/** Valores de las 12 claves `incentives.*` usadas, con su nombre completo de `settings`. */
export function incentiveSettingsSnapshot(s: IncentiveSettings): Record<string, unknown> {
  return {
    'incentives.history_start_period': s.historyStartPeriod,
    'incentives.history_months': s.historyMonths,
    'incentives.ticket_months': s.ticketMonths,
    'incentives.new_members_uplift_pct': s.newMembersUpliftPct,
    'incentives.renewal_rate_uplift_pts': s.renewalRateUpliftPts,
    'incentives.new_member_bonus_pct': s.newMemberBonusPct,
    'incentives.team_bonus_pct': s.teamBonusPct,
    'incentives.rounding_ars': s.roundingArs,
    'incentives.bonus_cap_ars': s.bonusCapArs,
    'incentives.expense_reference_periods': [...s.expenseReferencePeriods],
    'incentives.expense_reference_months': s.expenseReferenceMonths,
    'incentives.target_covers_costs': s.targetCoversCosts ? 1 : 0,
  };
}

// ───────────── Liquidación (regla 16) ─────────────

export interface IncentiveEvaluationInput {
  plan: Pick<IncentivePlan, 'targets' | 'amounts' | 'inputs'>;
  asOf: DateOnly;
  isFinal: boolean;
  /** Altas con cobro de P con su "Vendido por". */
  newMembers: readonly IncentiveNewMember[];
  renewals: { expirations: number; renewed: number; pending: number; lost: number; ratePct: number | null; graceEndsOn: DateOnly };
  /** Equipo completo, activas e inactivas (para la tabla, los nombres y el orden). */
  staff: readonly { id: string; displayName: string; sortOrder: number; isActive: boolean }[];
  finance: { incomeToDate: number; expensesToDate: number };
}

/**
 * Avance del mes o resultado final (regla 16), con umbrales inclusivos:
 * - equipo: si renovados ≥ mínimo, cada persona elegible de la lista congelada cobra el bono por persona;
 * - individual: si las altas con cobro (todas) ≥ objetivo, cada persona elegible cobra bono × sus altas.
 * Las altas de quienes no cobran bono o sin asignar cuentan para el objetivo pero no cobran.
 * Tabla por persona: todas las activas, las que vendieron altas en el mes (aunque estén inactivas)
 * y las elegibles de la lista congelada (para no perder un bono de alguien desactivado después).
 */
export function evaluateIncentives(input: IncentiveEvaluationInput): IncentiveProgress {
  const { plan } = input;
  const target = plan.targets.newMembers;
  const required = plan.targets.renewals;
  const eligible = new Map(plan.inputs.eligibleStaff.map((s) => [s.id, s]));
  const staffById = new Map(input.staff.map((s) => [s.id, s]));
  const counts = new Map<string, number>();
  const soldByNames = new Map<string, string>();
  let unassigned = 0;
  for (const m of input.newMembers) {
    if (!m.soldBy) {
      unassigned++;
      continue;
    }
    counts.set(m.soldBy.id, (counts.get(m.soldBy.id) ?? 0) + 1);
    soldByNames.set(m.soldBy.id, m.soldBy.displayName);
  }
  const actual = input.newMembers.length;
  const newMembersAchieved = actual >= target;
  const renewalsAchieved = input.renewals.renewed >= required;

  const ids = [...new Set([...input.staff.filter((s) => s.isActive).map((s) => s.id), ...counts.keys(), ...eligible.keys()])];
  const order = (id: string): number => staffById.get(id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const nameOf = (id: string): string => staffById.get(id)?.displayName ?? eligible.get(id)?.displayName ?? soldByNames.get(id) ?? '—';
  ids.sort((a, b) => order(a) - order(b) || nameOf(a).localeCompare(nameOf(b), 'es'));

  let staff: IncentiveStaffResult[] = ids.map((id) => {
    const isBonusEligible = eligible.has(id);
    const n = counts.get(id) ?? 0;
    const newMemberBonusArs = isBonusEligible && newMembersAchieved ? round2(n * plan.amounts.bonusPerNewMemberArs) : 0;
    const teamBonusArs = isBonusEligible && renewalsAchieved ? round2(plan.amounts.teamBonusPerPersonArs) : 0;
    return {
      staff: { id, displayName: nameOf(id) },
      isBonusEligible,
      newMembers: n,
      newMemberBonusArs,
      teamBonusArs,
      totalArs: round2(newMemberBonusArs + teamBonusArs),
    };
  });

  const totalsOf = (rows: IncentiveStaffResult[]) => ({
    newMemberBonusesArs: round2(sum(rows.map((r) => r.newMemberBonusArs))),
    teamBonusesArs: round2(sum(rows.map((r) => r.teamBonusArs))),
  });
  let t = totalsOf(staff);
  let capApplied = false;
  const cap = plan.amounts.capArs;
  if (cap !== null && cap > 0 && t.newMemberBonusesArs + t.teamBonusesArs > cap + EPS) {
    // Tope mensual: se prorratea lo de cada persona (a peso entero, sin pasar el tope).
    const factor = cap / (t.newMemberBonusesArs + t.teamBonusesArs);
    staff = staff.map((r) => {
      const newMemberBonusArs = Math.floor(r.newMemberBonusArs * factor + EPS);
      const teamBonusArs = Math.floor(r.teamBonusArs * factor + EPS);
      return { ...r, newMemberBonusArs, teamBonusArs, totalArs: newMemberBonusArs + teamBonusArs };
    });
    t = totalsOf(staff);
    capApplied = true;
  }

  return {
    asOf: input.asOf,
    isFinal: input.isFinal,
    newMembers: { actual, target, remaining: Math.max(0, target - actual), achieved: newMembersAchieved, unassigned },
    renewals: {
      expirations: input.renewals.expirations,
      renewed: input.renewals.renewed,
      pending: input.renewals.pending,
      lost: input.renewals.lost,
      ratePct: input.renewals.ratePct,
      targetRatePct: plan.targets.renewalRateTargetPct,
      required,
      achieved: renewalsAchieved,
      graceEndsOn: input.renewals.graceEndsOn,
    },
    staff,
    totals: { ...t, totalArs: round2(t.newMemberBonusesArs + t.teamBonusesArs), capApplied },
    finance: { incomeToDate: round2(input.finance.incomeToDate), expensesToDate: round2(input.finance.expensesToDate) },
    newMembersList: input.newMembers.map((m) => ({ ...m, soldBy: m.soldBy ? { ...m.soldBy } : null })),
  };
}
