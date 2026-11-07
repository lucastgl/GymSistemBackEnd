import {
  computeIncentivePlan,
  evaluateIncentives,
  IncentiveMonthFacts,
  IncentiveNewMember,
  IncentiveOverrides,
  IncentivePlan,
  IncentiveProgress,
  summarizeExpenses,
} from '../../domain/incentives/incentive-plan';
import { closableFrom, PeriodRenewals, RenewalTracker } from '../../domain/incentives/renewal-tracking';
import { Clock } from '../../domain/ports/ports';
import { StaffMemberRecord, StaffRef } from '../../domain/repositories/records';
import { IncentiveMonthlyFactsRecord, Repositories } from '../../domain/repositories/repositories';
import { BusinessSettings } from '../../domain/settings/business-settings';
import { DateOnly } from '../../domain/shared/date-only';
import { round2 } from '../../domain/shared/money';
import { Period } from '../../domain/shared/period';
import { fullName } from '../../domain/shared/text';

export type IncentiveRepos = Pick<Repositories, 'metrics' | 'incentives' | 'staff'>;

/** Cuántos meses hacia atrás se buscan meses con gastos completos para la referencia automática. */
const EXPENSE_LOOKBACK_MONTHS = 24;

/** Un mes con todo lo necesario: hechos SQL, renovaciones V1 y totales para el histórico. */
export interface IncentiveMonthData {
  period: Period;
  raw: IncentiveMonthlyFactsRecord;
  facts: IncentiveMonthFacts;
  renewals: PeriodRenewals;
  incomeTotal: number;
  expensesTotal: number;
}

export interface IncentiveData {
  today: DateOnly;
  firstDataPeriod: Period | null;
  /** Desde cuándo un primer pago cuenta como alta: primer día del primer mes con datos (regla 1). */
  newMemberSince: DateOnly;
  months: Map<Period, IncentiveMonthData>;
}

function emptyFacts(period: Period): IncentiveMonthlyFactsRecord {
  return { period, newMembersByStaff: [], payments: 0, paymentsAmount: 0, otherIncome: 0, expenseGroups: [] };
}

export const byStaffOrder = (a: StaffMemberRecord, b: StaffMemberRecord): number =>
  a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, 'es');

export const staffRef = (s: { id: string; displayName: string }): StaffRef => ({ id: s.id, displayName: s.displayName });

/**
 * Junta los datos en vivo (no usa `metric_snapshots`) y llama a la fórmula pura del dominio
 * (docs/03 §8). Lo comparten el simulador, la vista del mes, publicar, cerrar y el histórico.
 */
export class IncentivePlanner {
  constructor(private readonly clock: Clock) {}

  /** Hechos de [from, to] + seguimiento de renovaciones V1 (una sola carga de coberturas). */
  async loadData(
    repos: IncentiveRepos,
    from: Period,
    to: Period,
    settings: BusinessSettings,
    knownFirstDataPeriod?: Period | null,
  ): Promise<IncentiveData> {
    const today = this.clock.today();
    const firstDataPeriod = knownFirstDataPeriod !== undefined ? knownFirstDataPeriod : await repos.metrics.firstDataPeriod();
    const newMemberSince = Period.first(firstDataPeriod ?? from);
    const [rows, dataset] = await Promise.all([
      repos.incentives.monthlyFacts(from, to, newMemberSince),
      repos.metrics.loadDataset(to, settings.renewalGraceDays),
    ]);
    const tracker = new RenewalTracker(dataset.members, dataset.memberships, settings.renewalGraceDays);
    const byPeriod = new Map(rows.map((r) => [r.period, r]));
    const months = new Map<Period, IncentiveMonthData>();
    for (const period of Period.range(from, to)) {
      const raw = byPeriod.get(period) ?? emptyFacts(period);
      const renewals = tracker.forPeriod(period, today);
      const newMembers = raw.newMembersByStaff.reduce((a, r) => a + r.count, 0);
      const newMembersAmount = round2(raw.newMembersByStaff.reduce((a, r) => a + r.amount, 0));
      const expenses = summarizeExpenses(raw.expenseGroups);
      months.set(period, {
        period,
        raw,
        renewals,
        incomeTotal: round2(raw.paymentsAmount + raw.otherIncome),
        expensesTotal: expenses.total,
        facts: {
          period,
          newMembers,
          newMembersAmount,
          renewalPayments: Math.max(0, raw.payments - newMembers),
          renewalPaymentsAmount: round2(Math.max(0, raw.paymentsAmount - newMembersAmount)),
          expirations: renewals.hasData ? renewals.expirations : null,
          renewed: renewals.hasData ? renewals.renewed : null,
          renewalIsFinal: renewals.isFinal,
          otherIncome: raw.otherIncome,
          expenses: expenses.reference,
          expensesComplete: expenses.complete,
        },
      });
    }
    return { today, firstDataPeriod, newMemberSince, months };
  }

  /** Propuesta del mes P con los parámetros `incentives.*` y los reemplazos del simulador. */
  async buildPlan(
    repos: IncentiveRepos,
    period: Period,
    overrides: IncentiveOverrides,
    settings: BusinessSettings,
  ): Promise<{ plan: IncentivePlan; data: IncentiveData }> {
    const inc = settings.incentives;
    const firstDataPeriod = await repos.metrics.firstDataPeriod();
    const lookback = Math.max(EXPENSE_LOOKBACK_MONTHS, inc.historyMonths);
    let from = Period.of(Period.year(period), Period.month(period) - lookback);
    const configured = inc.expenseReferencePeriods.filter((p) => p < period);
    if (configured.length > 0 && configured[0]! < from) from = configured[0]!;
    if (firstDataPeriod === null || firstDataPeriod > period) from = period;
    else if (from < firstDataPeriod) from = firstDataPeriod;

    const data = await this.loadData(repos, from, period, settings, firstDataPeriod);
    const current = data.months.get(period)!;
    const eligibleStaff = (await repos.staff.list(false))
      .filter((s) => s.isBonusEligible)
      .sort(byStaffOrder)
      .map(staffRef);
    const previous = Period.previous(period);
    const previousMonthLastPaymentOn =
      data.firstDataPeriod !== null && previous >= data.firstDataPeriod ? await repos.incentives.lastPaymentOn(previous) : undefined;
    const isStarted = period <= Period.ofDate(data.today);
    const plan = computeIncentivePlan({
      period,
      today: data.today,
      generatedAt: this.clock.now().toISOString(),
      firstDataPeriod: data.firstDataPeriod,
      months: [...data.months.values()].filter((m) => m.period < period).map((m) => m.facts),
      expectedExpirations: current.renewals.expirations,
      eligibleStaff,
      settings: inc,
      renewalGraceDays: settings.renewalGraceDays,
      overrides,
      unassignedNewMembers: isStarted
        ? current.raw.newMembersByStaff.filter((r) => r.staffId === null).reduce((a, r) => a + r.count, 0)
        : 0,
      previousMonthLastPaymentOn,
    });
    return { plan, data };
  }

  /** Datos de un solo mes (para el avance de un plan ya congelado). */
  loadPeriod(repos: IncentiveRepos, period: Period, settings: BusinessSettings): Promise<IncentiveData> {
    return this.loadData(repos, period, period, settings);
  }

  /** Avance del mes (en vivo) o resultado final si `isFinal` (regla 16). */
  async buildProgress(
    repos: IncentiveRepos,
    period: Period,
    plan: IncentivePlan,
    data: IncentiveData,
    isFinal: boolean,
  ): Promise<IncentiveProgress> {
    const month = data.months.get(period)!;
    const [list, staff] = await Promise.all([
      repos.incentives.newMembersInPeriod(period, data.newMemberSince),
      repos.staff.list(true),
    ]);
    const newMembers: IncentiveNewMember[] = list.map((m) => ({
      memberId: m.memberId,
      legacyCode: m.legacyCode,
      fullName: fullName(m.firstName, m.lastName),
      paidOn: m.paidOn,
      amount: m.amount,
      planName: m.planName,
      soldBy: m.soldBy ? staffRef(m.soldBy) : null,
    }));
    return evaluateIncentives({
      plan,
      asOf: data.today,
      isFinal,
      newMembers,
      renewals: {
        expirations: month.renewals.expirations,
        renewed: month.renewals.renewed,
        pending: month.renewals.pending,
        lost: month.renewals.lost,
        ratePct: month.renewals.ratePct,
        graceEndsOn: month.renewals.graceEndsOn,
      },
      staff: staff.map((s) => ({ id: s.id, displayName: s.displayName, sortOrder: s.sortOrder, isActive: s.isActive })),
      finance: { incomeToDate: month.incomeTotal, expensesToDate: month.facts.expenses },
    });
  }

  /** Desde qué día se puede cerrar el mes (último vencimiento + gracia, nunca antes de terminar el mes). */
  closableFrom(period: Period, data: IncentiveData): DateOnly {
    return closableFrom(period, data.months.get(period)!.renewals);
  }
}
