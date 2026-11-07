import { TOP_LEVEL_METRIC_KEYS } from '../../../src/domain/metrics/metric-definitions';
import {
  calculateMonthlyMetrics,
  MetricsDataset,
  MetricsParameters,
} from '../../../src/domain/metrics/metrics-calculator';
import { DateOnly } from '../../../src/domain/shared/date-only';
import { Period } from '../../../src/domain/shared/period';

const D = (s: string) => s as DateOnly;
const MAY = '2026-05' as Period;

const params: MetricsParameters = {
  renewalGraceDays: 15,
  daysPerMonth: 30.4375,
  fixedCosts: { services: 250000, salaries: 700000, marketing: 100000, supplies: 80000, maintenance: 60000, contingency: 120000 },
  marketRent: 1100000,
  goals: { activeMembers: 95, churnPct: 18, avgTicket: 43000 },
};

/**
 * Fixture de mayo 2026:
 * A: alta 10/1; pagó 10/4→10/5 y renovó 12/5→11/6 (dentro de la gracia).
 * B: alta 1/2; pagó 5/4→5/5 y no renovó; baja automática el 21/5.
 * C: alta 15/5 (nuevo) con pago 15/5→14/6 (split efectivo + transferencia).
 * D: importado sin pagos (cobertura sintética 20/4→20/5, 03 §6b); no renovó.
 * E: alta 1/3; baja 30/4; reactivado 10/5 con pago 10/5→9/6.
 * G: alta 1/1; pagó 28/4→28/5 y renovó el 8/6 (fuera del mes pero dentro de la gracia).
 */
function mayDataset(): MetricsDataset {
  return {
    period: MAY,
    members: [
      { id: 'A', joinedAt: D('2026-01-10'), hasMemberships: true, lastRenewalAt: D('2026-05-12'), expiresAt: D('2026-06-11') },
      { id: 'B', joinedAt: D('2026-02-01'), hasMemberships: true, lastRenewalAt: D('2026-04-05'), expiresAt: D('2026-05-05') },
      { id: 'C', joinedAt: D('2026-05-15'), hasMemberships: true, lastRenewalAt: D('2026-05-15'), expiresAt: D('2026-06-14') },
      { id: 'D', joinedAt: D('2025-12-01'), hasMemberships: false, lastRenewalAt: D('2026-04-20'), expiresAt: D('2026-05-20') },
      { id: 'E', joinedAt: D('2026-03-01'), hasMemberships: true, lastRenewalAt: D('2026-05-10'), expiresAt: D('2026-06-09') },
      { id: 'G', joinedAt: D('2026-01-01'), hasMemberships: true, lastRenewalAt: D('2026-06-08'), expiresAt: D('2026-07-08') },
    ],
    statusEvents: [
      { memberId: 'E', type: 'CANCELLED', effectiveOn: D('2026-04-30'), seq: 1 },
      { memberId: 'E', type: 'REACTIVATED', effectiveOn: D('2026-05-10'), seq: 2 },
      { memberId: 'B', type: 'AUTO_CANCELLED', effectiveOn: D('2026-05-21'), seq: 3 },
    ],
    memberships: [
      { id: 'm1', memberId: 'A', startsOn: D('2026-04-10'), expiresOn: D('2026-05-10') },
      { id: 'm2', memberId: 'A', startsOn: D('2026-05-12'), expiresOn: D('2026-06-11') },
      { id: 'm3', memberId: 'B', startsOn: D('2026-04-05'), expiresOn: D('2026-05-05') },
      { id: 'm4', memberId: 'C', startsOn: D('2026-05-15'), expiresOn: D('2026-06-14') },
      { id: 'm5', memberId: 'E', startsOn: D('2026-05-10'), expiresOn: D('2026-06-09') },
      { id: 'm6', memberId: 'G', startsOn: D('2026-04-28'), expiresOn: D('2026-05-28') },
      { id: 'm7', memberId: 'G', startsOn: D('2026-06-08'), expiresOn: D('2026-07-08') },
    ],
    movements: [
      { type: 'INCOME', origin: 'RENEWAL', amount: 45000, categoryName: 'Renovación', splits: [{ method: 'CASH', amount: 45000 }] },
      {
        type: 'INCOME',
        origin: 'RENEWAL',
        amount: 40000,
        categoryName: 'Renovación',
        splits: [
          { method: 'CASH', amount: 10000 },
          { method: 'TRANSFER', amount: 30000 },
        ],
      },
      { type: 'INCOME', origin: 'RENEWAL', amount: 45000, categoryName: 'Renovación', splits: [{ method: 'TRANSFER', amount: 45000 }] },
      { type: 'INCOME', origin: 'MANUAL', amount: 20000, categoryName: 'Venta de bebidas', splits: [{ method: 'CASH', amount: 20000 }] },
      { type: 'EXPENSE', origin: 'MANUAL', amount: 15000.5, categoryName: 'Alquiler', splits: [{ method: 'CASH', amount: 15000.5 }] },
      { type: 'EXPENSE', origin: 'IMPORT', amount: 4999.5, categoryName: 'Limpieza', splits: [{ method: 'TRANSFER', amount: 4999.5 }] },
    ],
    attendances: [
      { memberId: 'A', checkedInOn: D('2026-05-02') },
      { memberId: 'A', checkedInOn: D('2026-05-03') },
      { memberId: 'C', checkedInOn: D('2026-05-20') },
      { memberId: 'E', checkedInOn: D('2026-05-11') },
    ],
    leads: [
      { stage: 'SIGNED_UP', contactedOn: D('2026-05-02') },
      { stage: 'LOST', contactedOn: D('2026-05-03') },
      { stage: 'NOT_INTERESTED', contactedOn: D('2026-05-04') },
      { stage: 'TRIAL_ATTENDED', contactedOn: D('2026-05-05') },
      { stage: 'FIRST_MESSAGE', contactedOn: D('2026-05-06') },
    ],
    availability: { hasPriorMembershipData: true, attendanceTracked: true, leadsTracked: true },
  };
}

const value = (r: ReturnType<typeof calculateMonthlyMetrics>, key: string) => r.values[key]?.value;

describe('calculadora de métricas V1 (03 §1-§4)', () => {
  const result = calculateMonthlyMetrics(mayDataset(), params, D('2026-06-10'));

  it('produce todas las claves de nivel superior', () => {
    for (const key of TOP_LEVEL_METRIC_KEYS) expect(result.values).toHaveProperty(key);
  });

  it('socios: activos al inicio/cierre por eventos, nuevos, bajas, permanencia y tasa de baja', () => {
    expect(value(result, 'members_active_start')).toBe(4); // A, B, D, G (E estaba de baja el 30/4)
    expect(value(result, 'members_active_end')).toBe(5); // A, C, D, E (reactivado), G; B de baja
    expect(value(result, 'members_new')).toBe(1);
    expect(value(result, 'members_cancelled')).toBe(1);
    expect(value(result, 'avg_tenure_months')).toBe(3.6); // (21/5 − 1/2) = 109 días / 30,4375
    expect(value(result, 'member_churn_pct')).toBe(25);
  });

  it('cuota vigente al cierre, renovaciones y vencimientos (con cobertura sintética del importado)', () => {
    expect(value(result, 'members_paying_end')).toBe(3); // A (m2), C (m4), E (m5)
    expect(value(result, 'renewals')).toBe(3); // m2, m4, m5
    expect(value(result, 'expirations')).toBe(4); // m1, m3, m6 y la sintética de D
  });

  it('churn con ventana de gracia: renovar dentro de vencimiento + 15 días cuenta como renovado', () => {
    // m1→m2 (12/5 ≤ 25/5) y m6→m7 (8/6 ≤ 12/6) renovados; m3 y D no.
    expect(value(result, 'expirations_not_renewed')).toBe(2);
    expect(value(result, 'churn_pct')).toBe(50);
  });

  it('es provisional mientras no venció la gracia (hoy ≤ fin(M) + 15) y deja de serlo después', () => {
    expect(result.graceElapsed).toBe(false);
    expect(result.values.expirations_not_renewed?.isProvisional).toBe(true);
    expect(result.values.churn_pct?.isProvisional).toBe(true);
    expect(result.values.members_cancelled?.isProvisional).toBe(false);
    const later = calculateMonthlyMetrics(mayDataset(), params, D('2026-06-16'));
    expect(later.graceElapsed).toBe(true);
    expect(later.values.churn_pct?.isProvisional).toBe(false);
    const edge = calculateMonthlyMetrics(mayDataset(), params, D('2026-06-15'));
    expect(edge.values.churn_pct?.isProvisional).toBe(true);
  });

  it('finanzas: ingresos, egresos, margen, ticket, escenario sostenible y punto de equilibrio', () => {
    expect(value(result, 'income_renewals')).toBe(130000);
    expect(value(result, 'income_other')).toBe(20000);
    expect(value(result, 'income_total')).toBe(150000);
    expect(value(result, 'expenses_total')).toBe(20000);
    expect(value(result, 'margin')).toBe(130000);
    expect(value(result, 'margin_pct')).toBe(86.7);
    expect(value(result, 'avg_ticket')).toBe(43333);
    expect(value(result, 'fixed_costs_reference')).toBe(1310000);
    expect(value(result, 'market_rent_reference')).toBe(1100000);
    expect(value(result, 'sustainable_margin')).toBe(-2260000);
    expect(value(result, 'income_per_paying_member')).toBe(50000);
    expect(value(result, 'breakeven_members')).toBe(49); // ceil(2.410.000 / 50.000)
  });

  it('breakdowns por método (splits) y por categoría, con claves con punto', () => {
    expect(value(result, 'income_by_method.CASH')).toBe(75000);
    expect(value(result, 'income_by_method.TRANSFER')).toBe(75000);
    expect(value(result, 'expenses_by_method.CASH')).toBe(15000.5);
    expect(value(result, 'income_by_category.renovacion')).toBe(130000);
    expect(value(result, 'income_by_category.venta_de_bebidas')).toBe(20000);
    expect(value(result, 'expenses_by_category.alquiler')).toBe(15000.5);
    expect(value(result, 'expenses_by_category.limpieza')).toBe(4999.5);
  });

  it('asistencias del mes', () => {
    expect(value(result, 'attendances_total')).toBe(4);
    expect(value(result, 'attendees_distinct')).toBe(3);
    expect(value(result, 'attendances_per_attendee')).toBe(1.3);
    expect(value(result, 'attendance_rate_pct')).toBe(100);
  });

  it('leads del mes por etapa actual', () => {
    expect(value(result, 'leads_total')).toBe(5);
    expect(value(result, 'leads_signed')).toBe(1);
    expect(value(result, 'leads_in_progress')).toBe(2);
    expect(value(result, 'leads_lost')).toBe(1);
    expect(value(result, 'leads_not_interested')).toBe(1);
    expect(value(result, 'leads_signed_pct')).toBe(20);
    expect(value(result, 'leads_in_progress_pct')).toBe(40);
    expect(value(result, 'leads_not_closed_pct')).toBe(40);
    expect(value(result, 'leads_by_stage.SIGNED_UP')).toBe(1);
  });

  it('congela los parámetros usados', () => {
    expect(value(result, 'params.fixed_costs.salaries')).toBe(700000);
    expect(value(result, 'params.renewal_grace_days')).toBe(15);
    expect(value(result, 'params.goals.churn_pct')).toBe(18);
  });
});

describe('null cuando el denominador es 0 o el dato no existe', () => {
  const empty: MetricsDataset = {
    period: '2026-04' as Period,
    members: [],
    statusEvents: [],
    memberships: [],
    movements: [],
    attendances: [],
    leads: [],
    availability: { hasPriorMembershipData: false, attendanceTracked: false, leadsTracked: true },
  };
  const r = calculateMonthlyMetrics(empty, params, D('2026-10-26'));

  it.each([
    'expirations',
    'expirations_not_renewed',
    'churn_pct',
    'member_churn_pct',
    'avg_tenure_months',
    'margin_pct',
    'avg_ticket',
    'income_per_paying_member',
    'breakeven_members',
    'attendances_total',
    'attendances_per_attendee',
    'attendance_rate_pct',
    'leads_signed_pct',
    'leads_in_progress_pct',
    'leads_not_closed_pct',
  ])('%s es null', (key) => {
    expect(r.values[key]?.value).toBeNull();
  });

  it('los conteos con datos disponibles siguen en 0', () => {
    expect(r.values.renewals?.value).toBe(0);
    expect(r.values.income_total?.value).toBe(0);
    expect(r.values.leads_total?.value).toBe(0);
    expect(r.values.members_active_end?.value).toBe(0);
  });

  it('abril (primer mes con pagos) no tiene vencimientos conocidos aunque haya coberturas', () => {
    const april = calculateMonthlyMetrics(
      {
        ...empty,
        members: [{ id: 'D', joinedAt: D('2025-12-01'), hasMemberships: false, lastRenewalAt: D('2026-03-20'), expiresAt: D('2026-04-19') }],
      },
      params,
      D('2026-10-26'),
    );
    expect(april.values.expirations?.value).toBeNull();
    expect(april.values.churn_pct?.value).toBeNull();
  });
});
