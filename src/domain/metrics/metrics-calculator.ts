import { isInProgress } from '../leads/lead-rules';
import { isCancellationEvent, statusAt, StatusEventLike } from '../members/member-status';
import { FIXED_COST_KEYS, FixedCostKey } from '../settings/business-settings';
import { DateOnly } from '../shared/date-only';
import { LEAD_STAGES, LeadStage, MemberStatusEventType, MovementOrigin, MovementType, PaymentMethod } from '../shared/enums';
import { Money, round1, round2 } from '../shared/money';
import { Period } from '../shared/period';
import { BREAKDOWN_PREFIXES, categorySlug, PROVISIONAL_KEYS } from './metric-definitions';

/** Socio no anulado con lo necesario para las métricas de padrón. */
export interface MetricsMember {
  id: string;
  joinedAt: DateOnly;
  /** true si tiene al menos una membresía registrada (de cualquier estado). */
  hasMemberships: boolean;
  lastRenewalAt: DateOnly | null;
  expiresAt: DateOnly | null;
}

export interface MetricsStatusEvent {
  memberId: string;
  type: MemberStatusEventType;
  effectiveOn: DateOnly;
  seq: number;
}

/** Membresía ACTIVE. */
export interface MetricsMembership {
  id: string;
  memberId: string;
  startsOn: DateOnly;
  expiresOn: DateOnly;
}

/** Movimiento de caja ACTIVE con fecha dentro del período. */
export interface MetricsMovement {
  type: MovementType;
  origin: MovementOrigin;
  amount: number;
  categoryName: string;
  splits: { method: PaymentMethod; amount: number }[];
}

export interface MetricsAttendance {
  memberId: string;
  checkedInOn: DateOnly;
}

export interface MetricsLead {
  stage: LeadStage;
  contactedOn: DateOnly;
}

/**
 * Datos crudos de un período. El repositorio filtra; la calculadora no consulta nada.
 * - members/statusEvents: todo el padrón no anulado y sus eventos con effective_on ≤ fin(M).
 * - memberships: ACTIVE con starts_on ≤ fin(M) + gracia.
 * - movements/attendances/leads: los del período.
 */
export interface MetricsDataset {
  period: Period;
  members: MetricsMember[];
  statusEvents: MetricsStatusEvent[];
  memberships: MetricsMembership[];
  movements: MetricsMovement[];
  attendances: MetricsAttendance[];
  leads: MetricsLead[];
  availability: {
    /** Hay pagos registrados antes del período (sin ellos no se conocen los vencimientos: abril 2026). */
    hasPriorMembershipData: boolean;
    /** Ya se registraban asistencias al terminar el período (desde mayo 2026). */
    attendanceTracked: boolean;
    /** Ya se registraban leads al terminar el período (desde marzo 2026). */
    leadsTracked: boolean;
  };
}

export interface MetricsParameters {
  renewalGraceDays: number;
  daysPerMonth: number;
  fixedCosts: Record<FixedCostKey, number>;
  marketRent: number;
  goals: { activeMembers: number; churnPct: number; avgTicket: number };
}

export interface ComputedMetricValue {
  value: number | null;
  isProvisional: boolean;
}

export interface MetricsResult {
  period: Period;
  graceElapsed: boolean;
  /** Claves de 03 (nivel superior) + breakdowns y parámetros con punto. */
  values: Record<string, ComputedMetricValue>;
}

/** La ventana de gracia de los vencimientos del mes ya venció: hoy > fin(M) + gracia. */
export function isGraceElapsed(period: Period, today: DateOnly, graceDays: number): boolean {
  return today > DateOnly.addDays(Period.last(period), graceDays);
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

function pct(num: number, den: number): number | null {
  const r = ratio(num, den);
  return r === null ? null : round1(r * 100);
}

/** Período cubierto por un pago (membresía ACTIVE) o la cobertura sintética de un importado sin pagos. */
export interface Coverage {
  memberId: string;
  startsOn: DateOnly;
  expiresOn: DateOnly;
}

/**
 * Coberturas: membresías reales + cobertura sintética para socios importados sin ningún pago
 * (`last_renewal_at → expires_at`, 03 §6b, M4 de fase2-observaciones-backend). La usan los
 * vencimientos y la cuota vigente de las métricas y las renovaciones del equipo (docs/03 §8).
 */
export function buildCoverages(members: readonly MetricsMember[], memberships: readonly MetricsMembership[]): Coverage[] {
  const coverages: Coverage[] = memberships.map((m) => ({
    memberId: m.memberId,
    startsOn: m.startsOn,
    expiresOn: m.expiresOn,
  }));
  for (const m of members) {
    if (!m.hasMemberships && m.expiresAt !== null) {
      coverages.push({ memberId: m.id, startsOn: m.lastRenewalAt ?? m.expiresAt, expiresOn: m.expiresAt });
    }
  }
  return coverages;
}

/**
 * Renovado (03 §1 `expirations_not_renewed`): existe una membresía posterior del mismo socio
 * que empieza a más tardar en `expires_on + gracia`. `memberMemberships` son las del socio.
 */
export function isRenewedWithinGrace(
  coverage: Coverage,
  memberMemberships: readonly MetricsMembership[],
  graceDays: number,
): boolean {
  const limit = DateOnly.addDays(coverage.expiresOn, graceDays);
  return memberMemberships.some((m2) => m2.startsOn > coverage.startsOn && m2.startsOn <= limit);
}

/**
 * Calculadora pura de las métricas V1 de un mes (docs/03 §1-§4).
 * Redondeos: porcentajes a 1 decimal, montos a 2, ticket a entero, permanencia a 1;
 * `null` cuando el denominador es 0 o el dato no existe para el período.
 */
export function calculateMonthlyMetrics(
  dataset: MetricsDataset,
  params: MetricsParameters,
  today: DateOnly,
): MetricsResult {
  const { period } = dataset;
  const ini = Period.first(period);
  const fin = Period.last(period);
  const dayBeforeIni = DateOnly.addDays(ini, -1);
  const graceElapsed = isGraceElapsed(period, today, params.renewalGraceDays);
  const values: Record<string, ComputedMetricValue> = {};
  const set = (key: string, value: number | null): void => {
    values[key] = { value, isProvisional: !graceElapsed && PROVISIONAL_KEYS.has(key) && value !== null };
  };

  // ── Socios ──
  const eventsByMember = new Map<string, StatusEventLike[]>();
  for (const e of dataset.statusEvents) {
    const list = eventsByMember.get(e.memberId) ?? [];
    list.push(e);
    eventsByMember.set(e.memberId, list);
  }
  const membersById = new Map(dataset.members.map((m) => [m.id, m]));

  let activeStart = 0;
  let activeEnd = 0;
  let newMembers = 0;
  for (const m of dataset.members) {
    const events = eventsByMember.get(m.id) ?? [];
    if (m.joinedAt < ini && statusAt(events, dayBeforeIni) !== 'CANCELLED') activeStart++;
    if (m.joinedAt <= fin && statusAt(events, fin) !== 'CANCELLED') activeEnd++;
    if (m.joinedAt >= ini && m.joinedAt <= fin) newMembers++;
  }

  const cancellations = dataset.statusEvents.filter(
    (e) => isCancellationEvent(e.type) && e.effectiveOn >= ini && e.effectiveOn <= fin && membersById.has(e.memberId),
  );
  const tenureMonths = cancellations.map(
    (e) => DateOnly.diffDays(membersById.get(e.memberId)!.joinedAt, e.effectiveOn) / params.daysPerMonth,
  );

  // Coberturas: membresías reales + cobertura sintética para socios importados sin ningún pago (03 §6b).
  const coverages = buildCoverages(dataset.members, dataset.memberships);

  const payingEnd = new Set(coverages.filter((c) => c.startsOn <= fin && c.expiresOn >= fin).map((c) => c.memberId)).size;
  const renewals = dataset.memberships.filter((m) => m.startsOn >= ini && m.startsOn <= fin).length;

  const membershipsByMember = new Map<string, MetricsMembership[]>();
  for (const m of dataset.memberships) {
    const list = membershipsByMember.get(m.memberId) ?? [];
    list.push(m);
    membershipsByMember.set(m.memberId, list);
  }
  let expirations: number | null = null;
  let notRenewed: number | null = null;
  if (dataset.availability.hasPriorMembershipData) {
    const expiring = coverages.filter((c) => c.expiresOn >= ini && c.expiresOn <= fin);
    expirations = expiring.length;
    let renewed = 0;
    for (const c of expiring) {
      if (isRenewedWithinGrace(c, membershipsByMember.get(c.memberId) ?? [], params.renewalGraceDays)) renewed++;
    }
    notRenewed = expirations - renewed;
  }

  set('members_active_start', activeStart);
  set('members_active_end', activeEnd);
  set('members_paying_end', payingEnd);
  set('members_new', newMembers);
  set('members_cancelled', cancellations.length);
  set('expirations', expirations);
  set('renewals', renewals);
  set('expirations_not_renewed', notRenewed);
  set('churn_pct', expirations === null || notRenewed === null ? null : pct(notRenewed, expirations));
  set('member_churn_pct', pct(cancellations.length, activeStart));
  set(
    'avg_tenure_months',
    tenureMonths.length === 0 ? null : round1(tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length),
  );

  // ── Finanzas ──
  let incomeRenewals = Money.ZERO;
  let incomeOther = Money.ZERO;
  let expenses = Money.ZERO;
  const incomeByMethod = new Map<string, Money>();
  const expenseByMethod = new Map<string, Money>();
  const incomeByCategory = new Map<string, Money>();
  const expenseByCategory = new Map<string, Money>();
  const addTo = (map: Map<string, Money>, key: string, amount: Money): void => {
    map.set(key, (map.get(key) ?? Money.ZERO).add(amount));
  };
  for (const mv of dataset.movements) {
    const amount = Money.fromDb(mv.amount);
    const slug = categorySlug(mv.categoryName);
    if (mv.type === 'INCOME') {
      if (mv.origin === 'RENEWAL') incomeRenewals = incomeRenewals.add(amount);
      else incomeOther = incomeOther.add(amount);
      addTo(incomeByCategory, slug, amount);
      for (const s of mv.splits) addTo(incomeByMethod, s.method, Money.fromDb(s.amount));
    } else {
      expenses = expenses.add(amount);
      addTo(expenseByCategory, slug, amount);
      for (const s of mv.splits) addTo(expenseByMethod, s.method, Money.fromDb(s.amount));
    }
  }
  const incomeTotal = incomeRenewals.add(incomeOther);
  const margin = incomeTotal.subtract(expenses);
  const fixedCosts = round2(FIXED_COST_KEYS.reduce((acc, k) => acc + (params.fixedCosts[k] ?? 0), 0));
  const marketRent = round2(params.marketRent);
  const incomePerPaying = payingEnd === 0 ? null : round2(incomeTotal.toNumber() / payingEnd);

  set('income_renewals', incomeRenewals.toNumber());
  set('income_other', incomeOther.toNumber());
  set('income_total', incomeTotal.toNumber());
  set('expenses_total', expenses.toNumber());
  set('margin', margin.toNumber());
  set('margin_pct', incomeTotal.cents === 0 ? null : round1((margin.cents / incomeTotal.cents) * 100));
  set('avg_ticket', renewals === 0 ? null : Math.round(incomeRenewals.toNumber() / renewals));
  set('fixed_costs_reference', fixedCosts);
  set('market_rent_reference', marketRent);
  set('sustainable_margin', round2(incomeTotal.toNumber() - fixedCosts - marketRent));
  set('income_per_paying_member', incomePerPaying);
  set(
    'breakeven_members',
    incomePerPaying === null || incomePerPaying === 0 ? null : Math.ceil((fixedCosts + marketRent) / incomePerPaying),
  );

  // ── Asistencias ──
  if (dataset.availability.attendanceTracked) {
    const total = dataset.attendances.length;
    const distinct = new Set(dataset.attendances.map((a) => a.memberId)).size;
    set('attendances_total', total);
    set('attendees_distinct', distinct);
    set('attendances_per_attendee', distinct === 0 ? null : round1(total / distinct));
    set('attendance_rate_pct', pct(distinct, payingEnd));
  } else {
    for (const k of ['attendances_total', 'attendees_distinct', 'attendances_per_attendee', 'attendance_rate_pct']) {
      set(k, null);
    }
  }

  // ── Leads ──
  const byStage = new Map<LeadStage, number>(LEAD_STAGES.map((s) => [s, 0]));
  for (const l of dataset.leads) byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + 1);
  if (dataset.availability.leadsTracked) {
    const total = dataset.leads.length;
    const signed = byStage.get('SIGNED_UP') ?? 0;
    const lost = byStage.get('LOST') ?? 0;
    const notInterested = byStage.get('NOT_INTERESTED') ?? 0;
    const inProgress = dataset.leads.filter((l) => isInProgress(l.stage)).length;
    set('leads_total', total);
    set('leads_signed', signed);
    set('leads_in_progress', inProgress);
    set('leads_lost', lost);
    set('leads_not_interested', notInterested);
    set('leads_signed_pct', pct(signed, total));
    set('leads_in_progress_pct', pct(inProgress, total));
    set('leads_not_closed_pct', pct(lost + notInterested, total));
    for (const [stage, count] of byStage) set(`${BREAKDOWN_PREFIXES.leadsByStage}${stage}`, count);
  } else {
    for (const k of [
      'leads_total',
      'leads_signed',
      'leads_in_progress',
      'leads_lost',
      'leads_not_interested',
      'leads_signed_pct',
      'leads_in_progress_pct',
      'leads_not_closed_pct',
    ]) {
      set(k, null);
    }
  }

  // ── Breakdowns (claves con punto) ──
  for (const [k, v] of incomeByMethod) set(`${BREAKDOWN_PREFIXES.incomeByMethod}${k}`, v.toNumber());
  for (const [k, v] of expenseByMethod) set(`${BREAKDOWN_PREFIXES.expenseByMethod}${k}`, v.toNumber());
  for (const [k, v] of incomeByCategory) set(`${BREAKDOWN_PREFIXES.incomeByCategory}${k}`, v.toNumber());
  for (const [k, v] of expenseByCategory) set(`${BREAKDOWN_PREFIXES.expenseByCategory}${k}`, v.toNumber());

  // ── Parámetros congelados en el cierre ──
  for (const k of FIXED_COST_KEYS) set(`${BREAKDOWN_PREFIXES.params}fixed_costs.${k}`, params.fixedCosts[k] ?? 0);
  set(`${BREAKDOWN_PREFIXES.params}market_rent`, params.marketRent);
  set(`${BREAKDOWN_PREFIXES.params}renewal_grace_days`, params.renewalGraceDays);
  set(`${BREAKDOWN_PREFIXES.params}days_per_month`, params.daysPerMonth);
  set(`${BREAKDOWN_PREFIXES.params}goals.active_members`, params.goals.activeMembers);
  set(`${BREAKDOWN_PREFIXES.params}goals.churn_pct`, params.goals.churnPct);
  set(`${BREAKDOWN_PREFIXES.params}goals.avg_ticket`, params.goals.avgTicket);

  return { period, graceElapsed, values };
}
