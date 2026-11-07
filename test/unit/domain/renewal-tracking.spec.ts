import { closableFrom, RenewalTracker } from '../../../src/domain/incentives/renewal-tracking';
import {
  buildCoverages,
  calculateMonthlyMetrics,
  isRenewedWithinGrace,
  MetricsMember,
  MetricsMembership,
} from '../../../src/domain/metrics/metrics-calculator';
import { DateOnly } from '../../../src/domain/shared/date-only';
import { Period } from '../../../src/domain/shared/period';

const D = (s: string) => s as DateOnly;
const P = (s: string) => s as Period;

/**
 * Noviembre 2026:
 * A vence 30/11 y renueva el 10/12 (dentro de la gracia) · B vence 30/11 y todavía no renovó ·
 * C vence 05/11 y no renovó (gracia vencida el 20/11) · D vence 20/11 y renueva el 15/11 (anticipado) ·
 * E importado sin pagos: cobertura sintética que vence el 12/11 · F vence en octubre (no cuenta).
 */
const members: MetricsMember[] = [
  { id: 'A', joinedAt: D('2026-01-01'), hasMemberships: true, lastRenewalAt: D('2026-12-10'), expiresAt: D('2027-01-09') },
  { id: 'B', joinedAt: D('2026-01-01'), hasMemberships: true, lastRenewalAt: D('2026-11-01'), expiresAt: D('2026-11-30') },
  { id: 'C', joinedAt: D('2026-01-01'), hasMemberships: true, lastRenewalAt: D('2026-10-06'), expiresAt: D('2026-11-05') },
  { id: 'D', joinedAt: D('2026-01-01'), hasMemberships: true, lastRenewalAt: D('2026-11-15'), expiresAt: D('2026-12-15') },
  { id: 'E', joinedAt: D('2025-06-01'), hasMemberships: false, lastRenewalAt: D('2026-10-13'), expiresAt: D('2026-11-12') },
  { id: 'F', joinedAt: D('2026-01-01'), hasMemberships: true, lastRenewalAt: D('2026-10-01'), expiresAt: D('2026-10-31') },
];
const memberships: MetricsMembership[] = [
  { id: 'a1', memberId: 'A', startsOn: D('2026-11-01'), expiresOn: D('2026-11-30') },
  { id: 'a2', memberId: 'A', startsOn: D('2026-12-10'), expiresOn: D('2027-01-09') },
  { id: 'b1', memberId: 'B', startsOn: D('2026-11-01'), expiresOn: D('2026-11-30') },
  { id: 'c1', memberId: 'C', startsOn: D('2026-10-06'), expiresOn: D('2026-11-05') },
  { id: 'd1', memberId: 'D', startsOn: D('2026-10-21'), expiresOn: D('2026-11-20') },
  { id: 'd2', memberId: 'D', startsOn: D('2026-11-15'), expiresOn: D('2026-12-15') },
  { id: 'f1', memberId: 'F', startsOn: D('2026-10-01'), expiresOn: D('2026-10-31') },
];

describe('renovaciones del equipo (lógica V1, docs/03 §8.1)', () => {
  const tracker = new RenewalTracker(members, memberships, 15);

  it('buildCoverages agrega la cobertura sintética del importado sin pagos (03 §6b)', () => {
    const coverages = buildCoverages(members, memberships);
    expect(coverages).toHaveLength(8);
    expect(coverages.find((c) => c.memberId === 'E')).toEqual({ memberId: 'E', startsOn: D('2026-10-13'), expiresOn: D('2026-11-12') });
  });

  it('isRenewedWithinGrace: membresía posterior que empieza a más tardar en vencimiento + gracia (inclusive)', () => {
    const c = { memberId: 'X', startsOn: D('2026-11-01'), expiresOn: D('2026-11-30') };
    const next = (startsOn: string) => [{ id: 'x', memberId: 'X', startsOn: D(startsOn), expiresOn: D('2027-01-01') }];
    expect(isRenewedWithinGrace(c, next('2026-12-15'), 15)).toBe(true);
    expect(isRenewedWithinGrace(c, next('2026-12-16'), 15)).toBe(false);
    expect(isRenewedWithinGrace(c, next('2026-11-01'), 15)).toBe(false); // no es posterior
  });

  it('a mitad de mes: renovados, pendientes dentro de la gracia y perdidos', () => {
    const nov = tracker.forPeriod(P('2026-11'), D('2026-11-25'));
    expect(nov).toMatchObject({ hasData: true, expirations: 5, renewed: 2, pending: 2, lost: 1, ratePct: 40, isFinal: false });
    expect(nov.items.map((i) => `${i.memberId}:${i.state}`)).toEqual(['C:LOST', 'E:PENDING', 'D:RENEWED', 'A:RENEWED', 'B:PENDING']);
    expect(nov.lastExpiresOn).toBe('2026-11-30');
    expect(nov.graceEndsOn).toBe('2026-12-15');
  });

  it('con la gracia vencida la cifra es definitiva y coincide con expirations_not_renewed de métricas', () => {
    const nov = tracker.forPeriod(P('2026-11'), D('2026-12-16'));
    expect(nov).toMatchObject({ expirations: 5, renewed: 2, pending: 0, lost: 3, isFinal: true });
    const metrics = calculateMonthlyMetrics(
      {
        period: P('2026-11'),
        members,
        statusEvents: [],
        memberships,
        movements: [],
        attendances: [],
        leads: [],
        availability: { hasPriorMembershipData: true, attendanceTracked: false, leadsTracked: false },
      },
      {
        renewalGraceDays: 15,
        daysPerMonth: 30.4375,
        fixedCosts: { services: 0, salaries: 0, marketing: 0, supplies: 0, maintenance: 0, contingency: 0 },
        marketRent: 0,
        goals: { activeMembers: 0, churnPct: 0, avgTicket: 0 },
      },
      D('2026-12-16'),
    );
    expect(metrics.values.expirations?.value).toBe(nov.expirations);
    expect(metrics.values.expirations_not_renewed?.value).toBe(nov.expirations - nov.renewed);
  });

  it('el día del fin de la gracia todavía no es definitivo', () => {
    expect(tracker.forPeriod(P('2026-11'), D('2026-12-15')).isFinal).toBe(false);
  });

  it('sin pagos anteriores al mes no hay datos de vencimientos (abril 2026)', () => {
    const oct = tracker.forPeriod(P('2026-10'), D('2026-11-25'));
    expect(oct.hasData).toBe(false);
    expect(oct.ratePct).toBeNull();
  });

  it('closableFrom: día siguiente al fin de la gracia del último vencimiento, nunca antes de terminar el mes', () => {
    expect(closableFrom(P('2026-11'), { graceEndsOn: D('2026-12-15') })).toBe('2026-12-16');
    expect(closableFrom(P('2026-11'), { graceEndsOn: D('2026-11-20') })).toBe('2026-12-01');
    const empty = new RenewalTracker([], [], 15).forPeriod(P('2026-11'), D('2026-11-06'));
    expect(empty.graceEndsOn).toBe('2026-12-15');
    expect(closableFrom(P('2026-11'), empty)).toBe('2026-12-16');
  });
});
