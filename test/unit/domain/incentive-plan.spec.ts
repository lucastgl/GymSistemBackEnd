import {
  BONUS_SUBCATEGORY,
  computeIncentivePlan,
  evaluateIncentives,
  FORMULA_VERSION,
  IncentiveMonthFacts,
  IncentiveNewMember,
  IncentivePlan,
  IncentivePlanInput,
  IncentiveSettings,
  isExpensesComplete,
  median,
  pickExpenseReferencePeriods,
  roundTo,
  summarizeExpenses,
} from '../../../src/domain/incentives/incentive-plan';
import { DateOnly } from '../../../src/domain/shared/date-only';
import { Period } from '../../../src/domain/shared/period';

const D = (s: string) => s as DateOnly;
const P = (s: string) => s as Period;

const SETTINGS: IncentiveSettings = {
  historyStartPeriod: P('2026-05'),
  historyMonths: 6,
  ticketMonths: 3,
  newMembersUpliftPct: 10,
  renewalRateUpliftPts: 0,
  newMemberBonusPct: 20,
  teamBonusPct: 2,
  roundingArs: 500,
  bonusCapArs: 0,
  expenseReferencePeriods: [],
  expenseReferenceMonths: 2,
  targetCoversCosts: true,
};

const TEAM = [
  { id: 'cris', displayName: 'Cristian' },
  { id: 'maru', displayName: 'Maru' },
  { id: 'aileen', displayName: 'Aileen' },
];

interface MonthSpec {
  period: string;
  newMembers: number;
  ticketNew: number;
  renewalPayments: number;
  ticketRenewal: number;
  expirations: number | null;
  renewed: number | null;
  final: boolean;
  otherIncome: number;
  expenses: number;
  complete: boolean;
}

const month = (m: MonthSpec): IncentiveMonthFacts => ({
  period: P(m.period),
  newMembers: m.newMembers,
  newMembersAmount: m.newMembers * m.ticketNew,
  renewalPayments: m.renewalPayments,
  renewalPaymentsAmount: m.renewalPayments * m.ticketRenewal,
  expirations: m.expirations,
  renewed: m.renewed,
  renewalIsFinal: m.final,
  otherIncome: m.otherIncome,
  expenses: m.expenses,
  expensesComplete: m.complete,
});

/**
 * Caso de oro A (base del 24/10): altas 8, 8, 11, 19, 5, 10; tasa 403/500 = 80,6 %; extra 6;
 * tickets 69.832 / 48.009; otros 15.400; gasto de referencia 4.213.477,5 (sep + oct); E = 3.
 */
function caseA(): IncentivePlanInput {
  const T = { ticketNew: 69_832, ticketRenewal: 48_009 };
  return {
    period: P('2026-11'),
    today: D('2026-11-06'),
    generatedAt: '2026-11-06T18:00:00.000Z',
    firstDataPeriod: P('2026-04'),
    months: [
      month({ period: '2026-04', newMembers: 12, ...T, renewalPayments: 49, expirations: null, renewed: null, final: true, otherIncome: 0, expenses: 1_951_023.85, complete: false }),
      month({ period: '2026-05', newMembers: 8, ...T, renewalPayments: 85, expirations: 100, renewed: 80, final: true, otherIncome: 20_000, expenses: 199_988, complete: false }),
      month({ period: '2026-06', newMembers: 8, ...T, renewalPayments: 87, expirations: 100, renewed: 81, final: true, otherIncome: 2_000, expenses: 83_010.96, complete: false }),
      month({ period: '2026-07', newMembers: 11, ...T, renewalPayments: 89, expirations: 100, renewed: 82, final: true, otherIncome: 69_000, expenses: 3_021_510, complete: true }),
      month({ period: '2026-08', newMembers: 19, ...T, renewalPayments: 86, expirations: 100, renewed: 80, final: true, otherIncome: 10_800, expenses: 3_109_698.71, complete: true }),
      month({ period: '2026-09', newMembers: 5, ...T, renewalPayments: 84, expirations: 100, renewed: 80, final: true, otherIncome: 0, expenses: 3_459_600, complete: true }),
      month({ period: '2026-10', newMembers: 10, ...T, renewalPayments: 60, expirations: 86, renewed: 55, final: false, otherIncome: 448_760, expenses: 4_967_355, complete: true }),
    ],
    expectedExpirations: 88,
    eligibleStaff: TEAM,
    settings: SETTINGS,
    renewalGraceDays: 15,
    unassignedNewMembers: 0,
    previousMonthLastPaymentOn: D('2026-10-24'),
  };
}

/**
 * Caso de oro B (datos finales del legacy, 06/11): altas 8, 8, 11, 19, 5, 11; tasa 258/320 =
 * 80,625 %; extra 6; tickets 69.266 / 48.075; otros 15.400; gasto 4.241.877,5; E = 3.
 */
function caseB(): IncentivePlanInput {
  const T = { ticketNew: 69_266, ticketRenewal: 48_075 };
  return {
    ...caseA(),
    months: [
      month({ period: '2026-04', newMembers: 12, ...T, renewalPayments: 49, expirations: null, renewed: null, final: true, otherIncome: 0, expenses: 1_951_023.85, complete: false }),
      month({ period: '2026-05', newMembers: 8, ...T, renewalPayments: 51, expirations: 61, renewed: 46, final: true, otherIncome: 20_000, expenses: 199_988, complete: false }),
      month({ period: '2026-06', newMembers: 8, ...T, renewalPayments: 52, expirations: 57, renewed: 46, final: true, otherIncome: 2_000, expenses: 83_010.96, complete: false }),
      month({ period: '2026-07', newMembers: 11, ...T, renewalPayments: 64, expirations: 66, renewed: 57, final: true, otherIncome: 69_000, expenses: 3_021_510, complete: true }),
      month({ period: '2026-08', newMembers: 19, ...T, renewalPayments: 56, expirations: 63, renewed: 50, final: true, otherIncome: 10_800, expenses: 3_109_698.71, complete: true }),
      month({ period: '2026-09', newMembers: 5, ...T, renewalPayments: 63, expirations: 73, renewed: 59, final: true, otherIncome: 0, expenses: 3_459_600, complete: true }),
      month({ period: '2026-10', newMembers: 11, ...T, renewalPayments: 70, expirations: 86, renewed: 60, final: false, otherIncome: 448_760, expenses: 5_024_155, complete: true }),
    ],
    unassignedNewMembers: 8,
    previousMonthLastPaymentOn: D('2026-10-31'),
  };
}

const codes = (plan: IncentivePlan) => plan.warnings.map((w) => w.code).sort();

describe('Fórmula v1 · casos de oro (docs/03 §8.5)', () => {
  it('A (24/10): mediana 9 / estadístico 10 / mínimo 71 / bono alta 14.000 / bono persona 22.500 / equilibrio 11 / objetivo 11 / neto 45.267,5', () => {
    const plan = computeIncentivePlan(caseA());
    expect(plan.inputs.newMembersMedian).toBe(9);
    expect(plan.targets.newMembersStatistical).toBe(10);
    expect(plan.inputs.renewalRateHistPct).toBe(80.6);
    expect(plan.targets.renewalRateTargetPct).toBe(80.6);
    expect(plan.targets.renewals).toBe(71);
    expect(plan.inputs.extraRenewalPayments).toBe(6);
    expect(plan.inputs.ticketNewMember).toBe(69_832);
    expect(plan.inputs.ticketRenewal).toBe(48_009);
    expect(plan.inputs.otherIncome).toBe(15_400);
    expect(plan.inputs.expenseReferenceArs).toBe(4_213_477.5);
    expect(plan.amounts.bonusPerNewMemberArs).toBe(14_000);
    expect(plan.amounts.teamBonusPerPersonArs).toBe(22_500); // 22.724,26 → 22.500
    expect(plan.amounts.teamBonusTotalArs).toBe(67_500);
    expect(plan.targets.newMembersBreakeven).toBe(11);
    expect(plan.targets.newMembers).toBe(11);
    expect(plan.targets.newMembersSource).toBe('BREAKEVEN');
    expect(plan.projection.resultBeforeBonuses).toBe(266_767.5);
    expect(plan.projection.bonuses).toBe(221_500);
    expect(plan.projection.resultAfterBonuses).toBe(45_267.5);
    expect(codes(plan)).toEqual(['COST_STRUCTURE_CHANGED', 'DATA_GAP_PREVIOUS_MONTH', 'PROVISIONAL_RENEWAL_DATA', 'TARGET_RAISED_TO_BREAKEVEN']);
  });

  it('B (final): mediana 9,5 / estadístico 11 / mínimo 71 / bono alta 14.000 / bono persona 23.000 / equilibrio 11 / objetivo 11 / neto 14.223,5', () => {
    const plan = computeIncentivePlan(caseB());
    expect(plan.inputs.newMembersMedian).toBe(9.5);
    expect(plan.targets.newMembersStatistical).toBe(11);
    expect(plan.targets.newMembersAchievedMonths).toBe(3);
    expect(plan.inputs.renewalRateHistPct).toBe(80.625);
    expect(plan.targets.renewalRateTargetPct).toBe(80.63); // congelada con 2 decimales
    expect(plan.targets.renewals).toBe(71);
    expect(plan.inputs.extraRenewalPayments).toBe(6);
    expect(plan.inputs.ticketNewMember).toBe(69_266);
    expect(plan.inputs.ticketRenewal).toBe(48_075);
    expect(plan.inputs.expenseReferenceArs).toBe(4_241_877.5);
    expect(plan.inputs.expenseReferenceSource).toBe('AUTO');
    expect(plan.inputs.lastCompleteMonthExpenses).toBe(5_024_155);
    expect(plan.amounts.bonusPerNewMemberArs).toBe(14_000); // 13.853,2 → 14.000
    expect(plan.amounts.teamBonusPerPersonArs).toBe(23_000); // 22.755,5 → 23.000
    expect(plan.amounts.teamBonusTotalArs).toBe(69_000);
    expect(plan.targets.newMembersBreakeven).toBe(11);
    expect(plan.targets.newMembers).toBe(11);
    expect(plan.targets.newMembersSource).toBe('STATISTICAL');
    expect(plan.projection).toMatchObject({
      incomeNewMembers: 761_926,
      incomeRenewals: 3_413_325,
      incomeExtraRenewals: 288_450,
      incomeOther: 15_400,
      incomeTotal: 4_479_101,
      expenses: 4_241_877.5,
      bonuses: 223_000,
      resultBeforeBonuses: 237_223.5,
      resultAfterBonuses: 14_223.5,
    });
    expect(codes(plan)).toEqual(['COST_STRUCTURE_CHANGED', 'PROVISIONAL_RENEWAL_DATA', 'UNASSIGNED_NEW_MEMBERS']);
  });

  it('B: ventana, meses de la tasa (gracia vencida), tickets, gasto y elegibles quedan en el plan', () => {
    const plan = computeIncentivePlan(caseB());
    expect(plan.formulaVersion).toBe(FORMULA_VERSION);
    expect(plan.window).toEqual({
      periods: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      renewalRatePeriods: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
      ticketPeriods: ['2026-08', '2026-09', '2026-10'],
      expenseReferencePeriods: ['2026-09', '2026-10'],
    });
    expect(plan.inputs.newMembersByPeriod.map((m) => m.count)).toEqual([8, 8, 11, 19, 5, 11]);
    expect(plan.inputs.eligibleStaff).toEqual(TEAM);
    expect(Object.keys(plan.settings).sort()).toEqual([
      'incentives.bonus_cap_ars',
      'incentives.expense_reference_months',
      'incentives.expense_reference_periods',
      'incentives.history_months',
      'incentives.history_start_period',
      'incentives.new_member_bonus_pct',
      'incentives.new_members_uplift_pct',
      'incentives.renewal_rate_uplift_pts',
      'incentives.rounding_ars',
      'incentives.target_covers_costs',
      'incentives.team_bonus_pct',
      'incentives.ticket_months',
    ]);
    expect(plan.settings).toMatchObject({ 'incentives.new_member_bonus_pct': 20, 'incentives.target_covers_costs': 1, 'incentives.expense_reference_periods': [] });
    expect(plan.acceptedNegativeResult).toBe(false);
    const msg = plan.warnings.find((w) => w.code === 'PROVISIONAL_RENEWAL_DATA')!.message;
    expect(msg).toContain('octubre');
    expect(plan.warnings.find((w) => w.code === 'UNASSIGNED_NEW_MEMBERS')!.message).toContain('8 altas de noviembre');
    expect(plan.warnings.find((w) => w.code === 'COST_STRUCTURE_CHANGED')!.message).toContain('$5.024.155');
  });

  it('B: con el gasto proyectado de noviembre (~4,41 M) el objetivo sube a 14, logrado en 1 de 6 meses', () => {
    const plan = computeIncentivePlan({ ...caseB(), overrides: { expenseReferenceArs: 4_410_000 } });
    expect(plan.inputs.expenseReferenceSource).toBe('OVERRIDE');
    expect(plan.window.expenseReferencePeriods).toEqual([]);
    expect(plan.targets.newMembersBreakeven).toBe(14);
    expect(plan.targets.newMembers).toBe(14);
    expect(plan.targets.newMembersAchievedMonths).toBe(1);
    expect(codes(plan)).toContain('TARGET_RAISED_TO_BREAKEVEN');
  });
});

describe('Fórmula v1 · bordes', () => {
  it('roundTo redondea al múltiplo más cercano (medio para arriba) y aguanta el punto de corte', () => {
    expect(roundTo(22_755.5, 500)).toBe(23_000);
    expect(roundTo(13_853, 500)).toBe(14_000);
    expect(roundTo(22_724, 500)).toBe(22_500);
    expect(roundTo(22_750, 500)).toBe(23_000);
    expect(roundTo(22_749.99, 500)).toBe(22_500);
    expect(roundTo(0, 500)).toBe(0);
    expect(roundTo(1234.567, 0)).toBe(1234.57);
  });

  it('mediana: impar, par (promedio de los centrales) y vacía', () => {
    expect(median([5, 19, 8])).toBe(8);
    expect(median([8, 8, 11, 19, 5, 11])).toBe(9.5);
    expect(median([])).toBeNull();
  });

  it('el estadístico no se pasa por error de punto flotante (mediana 10 × 1,1 = 11, no 12)', () => {
    const base = caseB();
    const months = base.months.map((m) => (m.period >= '2026-05' ? { ...m, newMembers: 10 } : m));
    const plan = computeIncentivePlan({ ...base, months });
    expect(plan.targets.newMembersStatistical).toBe(11);
  });

  it('umbral del gasto: más de 10 % sobre la referencia avisa; justo 10 % no', () => {
    const base = caseB();
    const settings = { ...SETTINGS, expenseReferencePeriods: [P('2026-09')] }; // referencia = 3.459.600
    const withOct = (expenses: number) => base.months.map((m) => (m.period === '2026-10' ? { ...m, expenses } : m));
    expect(codes(computeIncentivePlan({ ...base, settings, months: withOct(3_805_560) }))).not.toContain('COST_STRUCTURE_CHANGED');
    expect(codes(computeIncentivePlan({ ...base, settings, months: withOct(3_805_561) }))).toContain('COST_STRUCTURE_CHANGED');
  });

  it('margen ≤ 0 por alta: sin equilibrio alcanzable el objetivo queda en el estadístico', () => {
    const plan = computeIncentivePlan({ ...caseB(), overrides: { bonusPerNewMemberArs: 70_000 } });
    expect(plan.amounts.bonusPerNewMemberArs).toBe(70_000);
    expect(plan.targets.newMembersBreakeven).toBeNull();
    expect(plan.targets.newMembers).toBe(11);
    expect(plan.targets.newMembersSource).toBe('STATISTICAL');
    expect(codes(plan)).toContain('RESULT_NEGATIVE');
  });

  it('si los ingresos fijos ya cubren gastos y bonos, el equilibrio es 0', () => {
    const plan = computeIncentivePlan({ ...caseB(), overrides: { expenseReferenceArs: 1_000_000 } });
    expect(plan.targets.newMembersBreakeven).toBe(0);
    expect(plan.targets.newMembers).toBe(11);
  });

  it('target_covers_costs = 0: el objetivo es el estadístico aunque el equilibrio sea mayor', () => {
    const plan = computeIncentivePlan({ ...caseA(), settings: { ...SETTINGS, targetCoversCosts: false } });
    expect(plan.targets.newMembersBreakeven).toBe(11);
    expect(plan.targets.newMembers).toBe(10);
    expect(plan.targets.newMembersSource).toBe('STATISTICAL');
  });

  it('reemplazos del simulador: objetivo, tasa, porcentajes y montos', () => {
    const plan = computeIncentivePlan({
      ...caseB(),
      overrides: { newMembersTarget: 9, renewalRateTargetPct: 90, newMemberBonusPct: 10, teamBonusPerPersonArs: 10_000, newMembersUpliftPct: 0 },
    });
    expect(plan.targets.newMembersStatistical).toBe(10); // ceil(9,5)
    expect(plan.targets.newMembers).toBe(9);
    expect(plan.targets.newMembersSource).toBe('OVERRIDE');
    expect(plan.targets.renewalRateTargetPct).toBe(90);
    expect(plan.targets.renewals).toBe(80); // ceil(88 × 0,9) = ceil(79,2)
    expect(plan.amounts.bonusPerNewMemberArs).toBe(7_000); // 6.926,6 → 7.000
    expect(plan.amounts.teamBonusPerPersonArs).toBe(10_000);
    expect(plan.amounts.teamBonusTotalArs).toBe(30_000);
    expect(plan.overrides).toEqual({ newMembersTarget: 9, renewalRateTargetPct: 90, newMemberBonusPct: 10, teamBonusPerPersonArs: 10_000, newMembersUpliftPct: 0 });
    const uplift = computeIncentivePlan({ ...caseB(), overrides: { renewalRateUpliftPts: 5 } });
    expect(uplift.targets.renewalRateTargetPct).toBe(85.63);
    expect(uplift.targets.renewals).toBe(76); // ceil(88 × 0,8563) = ceil(75,35)
  });

  it('tope mensual: prorratea los montos (múltiplos de 500) sin pasarse y avisa CAP_APPLIED', () => {
    const plan = computeIncentivePlan({ ...caseB(), settings: { ...SETTINGS, bonusCapArs: 200_000 } });
    expect(plan.amounts.capArs).toBe(200_000);
    expect(plan.amounts.bonusPerNewMemberArs).toBe(12_500);
    expect(plan.amounts.teamBonusPerPersonArs).toBe(20_500);
    expect(plan.amounts.totalAtTargetArs).toBe(199_000);
    expect(plan.amounts.totalAtTargetArs).toBeLessThanOrEqual(200_000);
    expect(codes(plan)).toContain('CAP_APPLIED');
    const noCap = computeIncentivePlan({ ...caseB(), settings: { ...SETTINGS, bonusCapArs: 300_000 } });
    expect(noCap.amounts.totalAtTargetArs).toBe(223_000);
    expect(codes(noCap)).not.toContain('CAP_APPLIED');
  });

  it('sin personas elegibles: bono de equipo en 0 y NO_ELIGIBLE_STAFF', () => {
    const plan = computeIncentivePlan({ ...caseB(), eligibleStaff: [] });
    expect(plan.amounts.teamBonusPerPersonArs).toBe(0);
    expect(plan.amounts.teamBonusTotalArs).toBe(0);
    expect(codes(plan)).toContain('NO_ELIGIBLE_STAFF');
  });

  it('meses provisionales: sin meses con la gracia vencida no hay tasa ni pagos extra', () => {
    const base = caseB();
    const months = base.months.map((m) => ({ ...m, renewalIsFinal: false }));
    const plan = computeIncentivePlan({ ...base, months });
    expect(plan.inputs.renewalRateHistPct).toBeNull();
    expect(plan.targets.renewalRateTargetPct).toBe(0);
    expect(plan.targets.renewals).toBe(0);
    expect(plan.inputs.extraRenewalPayments).toBe(0);
    expect(plan.window.renewalRatePeriods).toEqual([]);
    expect(codes(plan)).toContain('NO_RENEWAL_RATE');
    expect(codes(plan)).not.toContain('PROVISIONAL_RENEWAL_DATA');
    const manual = computeIncentivePlan({ ...base, months, overrides: { renewalRateTargetPct: 80 } });
    expect(manual.targets.renewals).toBe(71); // ceil(70,4)
    expect(codes(manual)).not.toContain('NO_RENEWAL_RATE');
  });

  it('sin historia: NO_HISTORY; con pocos meses: FEW_HISTORY_MONTHS', () => {
    const empty = computeIncentivePlan({ ...caseB(), firstDataPeriod: null, months: [] });
    expect(empty.window.periods).toEqual([]);
    expect(empty.targets.newMembersStatistical).toBe(0);
    expect(empty.inputs.ticketNewMember).toBeNull();
    expect(empty.inputs.expenseReferenceArs).toBeNull();
    expect(codes(empty)).toEqual(expect.arrayContaining(['NO_HISTORY', 'NO_RENEWAL_RATE', 'EXPENSES_NOT_AVAILABLE']));
    const few = computeIncentivePlan({ ...caseB(), settings: { ...SETTINGS, historyStartPeriod: P('2026-08') } });
    expect(few.window.periods).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(few.targets.newMembersStatistical).toBe(13); // mediana 11 × 1,1 = 12,1 → 13
    expect(codes(few)).toContain('FEW_HISTORY_MONTHS');
  });

  it('gasto de referencia: meses fijos (SETTING) y sin meses completos (EXPENSES_NOT_AVAILABLE)', () => {
    const fixed = computeIncentivePlan({ ...caseB(), settings: { ...SETTINGS, expenseReferencePeriods: [P('2026-07'), P('2026-09')] } });
    expect(fixed.inputs.expenseReferenceSource).toBe('SETTING');
    expect(fixed.window.expenseReferencePeriods).toEqual(['2026-07', '2026-09']);
    expect(fixed.inputs.expenseReferenceArs).toBe(3_240_555); // (3.021.510 + 3.459.600) / 2
    const none = computeIncentivePlan({ ...caseB(), months: caseB().months.map((m) => ({ ...m, expensesComplete: false })) });
    expect(none.inputs.expenseReferenceArs).toBeNull();
    expect(none.targets.newMembersBreakeven).toBeNull();
    expect(none.projection.resultAfterBonuses).toBeNull();
    expect(codes(none)).toContain('EXPENSES_NOT_AVAILABLE');
    expect(
      pickExpenseReferencePeriods(P('2026-11'), caseB().months, { ...SETTINGS, expenseReferencePeriods: [P('2026-12')] }, P('2026-04'), D('2026-11-06')),
    ).toEqual({ periods: ['2026-09', '2026-10'], source: 'AUTO' });
  });

  it('el gasto automático no usa meses anteriores a history_start_period (abril, carga inicial) aunque estén completos', () => {
    const base = caseB();
    const onlyApril = base.months.map((m) => ({ ...m, expensesComplete: m.period === '2026-04' }));
    const plan = computeIncentivePlan({ ...base, months: onlyApril });
    expect(plan.inputs.expenseReferenceArs).toBeNull();
    expect(plan.inputs.lastCompleteMonthExpenses).toBeNull();
    expect(codes(plan)).toContain('EXPENSES_NOT_AVAILABLE');
  });

  it('solo usa meses cerrados: simulando el mes que viene, el mes en curso no entra en W ni en el gasto', () => {
    const base = caseB();
    const months = [
      ...base.months,
      month({ period: '2026-11', newMembers: 8, ticketNew: 60_000, renewalPayments: 29, ticketRenewal: 50_000, expirations: 88, renewed: 20, final: false, otherIncome: 4_000, expenses: 6_000_000, complete: true }),
    ];
    const december = computeIncentivePlan({ ...base, period: P('2026-12'), months });
    expect(december.window.periods).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(december.window.expenseReferencePeriods).toEqual(['2026-09', '2026-10']);
    expect(december.inputs.lastCompleteMonthExpenses).toBe(5_024_155);
    const onOct27 = computeIncentivePlan({ ...base, today: D('2026-10-27') });
    expect(onOct27.window.periods).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09']); // octubre todavía no cerró
    expect(onOct27.window.expenseReferencePeriods).toEqual(['2026-08', '2026-09']);
    expect(codes(onOct27)).toContain('FEW_HISTORY_MONTHS');
  });

  it('TARGET_ABOVE_HISTORY si ningún mes de W llegó al objetivo', () => {
    const plan = computeIncentivePlan({ ...caseB(), overrides: { newMembersTarget: 25 } });
    expect(plan.targets.newMembersAchievedMonths).toBe(0);
    expect(codes(plan)).toContain('TARGET_ABOVE_HISTORY');
  });

  it('cobros de equilibrio sin bonos = renovaciones + extra + altas que faltan para cubrir el gasto', () => {
    // (71 + 6) + ceil((4.241.877,5 − 3.717.175) / 69.266) = 77 + ceil(7,58) = 85
    expect(computeIncentivePlan(caseB()).projection.breakevenPayments).toBe(85);
    expect(computeIncentivePlan({ ...caseB(), overrides: { expenseReferenceArs: 1_000_000 } }).projection.breakevenPayments).toBe(77);
    const none = computeIncentivePlan({ ...caseB(), months: caseB().months.map((m) => ({ ...m, expensesComplete: false })) });
    expect(none.projection.breakevenPayments).toBeNull();
  });
});

describe('gastos completos y subcategoría "Bonos" (regla 7)', () => {
  const groups = [
    { categoryName: 'Alquiler', subcategory: null, amount: 1_100_000, count: 1 },
    { categoryName: 'Sueldos y liquidaciones', subcategory: 'Cristian', amount: 700_000, count: 1 },
    { categoryName: 'Sueldos y liquidaciones', subcategory: BONUS_SUBCATEGORY, amount: 223_000, count: 3 },
    { categoryName: 'Servicios', subcategory: 'Luz', amount: 80_000, count: 1 },
  ];

  it('excluye los bonos del gasto de referencia pero no del total', () => {
    expect(summarizeExpenses(groups)).toEqual({ total: 2_103_000, reference: 1_880_000, complete: true });
  });

  it('completo = al menos un egreso en Alquiler y uno en Sueldos (un bono no cuenta como liquidación)', () => {
    expect(isExpensesComplete(groups)).toBe(true);
    expect(isExpensesComplete(groups.filter((g) => g.categoryName !== 'Alquiler'))).toBe(false);
    expect(isExpensesComplete(groups.filter((g) => g.subcategory !== 'Cristian'))).toBe(false);
    expect(isExpensesComplete([{ categoryName: 'alquiler', subcategory: null, amount: 1, count: 1 }, { categoryName: 'SUELDOS Y LIQUIDACIONES', subcategory: 'bonos ', amount: 1, count: 1 }])).toBe(false);
  });
});

describe('liquidación (regla 16)', () => {
  const plan = computeIncentivePlan(caseB());
  const newMember = (n: number, soldBy: { id: string; displayName: string } | null): IncentiveNewMember => ({
    memberId: `m${n}`,
    legacyCode: `LB${200 + n}`,
    fullName: `Socio ${n}`,
    paidOn: '2026-11-10',
    amount: 69_266,
    planName: 'Plus',
    soldBy,
  });
  const staff = [
    { id: 'cris', displayName: 'Cristian', sortOrder: 1, isActive: true },
    { id: 'maru', displayName: 'Maru', sortOrder: 2, isActive: true },
    { id: 'aileen', displayName: 'Aileen', sortOrder: 3, isActive: true },
    { id: 'gio', displayName: 'Giovanni', sortOrder: 4, isActive: true },
    { id: 'lucas', displayName: 'Lucas', sortOrder: 5, isActive: true },
    { id: 'ludmila', displayName: 'Ludmila', sortOrder: 6, isActive: false },
  ];
  const renewals = (renewed: number) => ({ expirations: 88, renewed, pending: 0, lost: 88 - renewed, ratePct: null, graceEndsOn: D('2026-12-15') });
  const altas = (total: number) =>
    Array.from({ length: total }, (_, i) =>
      newMember(i, i < 4 ? TEAM[0]! : i < 7 ? TEAM[1]! : i < 9 ? { id: 'gio', displayName: 'Giovanni' } : i < 10 ? null : TEAM[2]!),
    );

  it('umbrales inclusivos: 11 altas y 71 renovados cobran; Giovanni, Lucas y las sin asignar cuentan pero no cobran', () => {
    const r = evaluateIncentives({ plan, asOf: D('2026-12-16'), isFinal: true, newMembers: altas(11), renewals: renewals(71), staff, finance: { incomeToDate: 0, expensesToDate: 0 } });
    expect(r.newMembers).toEqual({ actual: 11, target: 11, remaining: 0, achieved: true, unassigned: 1 });
    expect(r.renewals).toMatchObject({ renewed: 71, required: 71, achieved: true, targetRatePct: 80.63 });
    expect(r.staff.map((s) => [s.staff.displayName, s.isBonusEligible, s.newMembers, s.newMemberBonusArs, s.teamBonusArs, s.totalArs])).toEqual([
      ['Cristian', true, 4, 56_000, 23_000, 79_000],
      ['Maru', true, 3, 42_000, 23_000, 65_000],
      ['Aileen', true, 1, 14_000, 23_000, 37_000],
      ['Giovanni', false, 2, 0, 0, 0],
      ['Lucas', false, 0, 0, 0, 0], // activa sin altas: figura con 0; Ludmila (inactiva, sin altas) no
    ]);
    expect(r.totals).toEqual({ newMemberBonusesArs: 112_000, teamBonusesArs: 69_000, totalArs: 181_000, capApplied: false });
    expect(r.isFinal).toBe(true);
  });

  it('una alta o una renovación menos y no se cobra ese bono', () => {
    const r = evaluateIncentives({ plan, asOf: D('2026-12-16'), isFinal: true, newMembers: altas(10), renewals: renewals(70), staff, finance: { incomeToDate: 0, expensesToDate: 0 } });
    expect(r.newMembers).toMatchObject({ actual: 10, remaining: 1, achieved: false });
    expect(r.renewals.achieved).toBe(false);
    expect(r.totals.totalArs).toBe(0);
    expect(r.staff.every((s) => s.totalArs === 0)).toBe(true);
  });

  it('una persona inactiva aparece si vendió altas en el mes o si estaba en la lista congelada', () => {
    const inactive = staff.map((s) => (s.id === 'gio' || s.id === 'aileen' ? { ...s, isActive: false } : s));
    const r = evaluateIncentives({ plan, asOf: D('2026-12-16'), isFinal: true, newMembers: altas(9), renewals: renewals(71), staff: inactive, finance: { incomeToDate: 0, expensesToDate: 0 } });
    // Giovanni (inactivo) vendió 2; Aileen (inactiva, elegible congelada) no vendió pero cobra el bono de equipo.
    expect(r.staff.map((s) => [s.staff.displayName, s.newMembers, s.totalArs])).toEqual([
      ['Cristian', 4, 23_000],
      ['Maru', 3, 23_000],
      ['Aileen', 0, 23_000],
      ['Giovanni', 2, 0],
      ['Lucas', 0, 0],
    ]);
  });

  it('con tope, prorratea lo de cada persona sin pasarse', () => {
    const capped = { ...plan, amounts: { ...plan.amounts, capArs: 100_000 } };
    const r = evaluateIncentives({ plan: capped, asOf: D('2026-12-16'), isFinal: true, newMembers: altas(11), renewals: renewals(71), staff, finance: { incomeToDate: 0, expensesToDate: 0 } });
    expect(r.totals.capApplied).toBe(true);
    expect(r.totals.totalArs).toBeLessThanOrEqual(100_000);
    expect(r.totals.totalArs).toBeGreaterThan(99_990);
  });
});
