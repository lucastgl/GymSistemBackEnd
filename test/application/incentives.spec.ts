import { randomUUID } from 'node:crypto';
import { IncentivePlanner } from '../../src/application/incentives/incentive-planner';
import {
  CloseIncentivePeriodUseCase,
  GetIncentivePeriodUseCase,
  GetIncentivePlanUseCase,
  GetIncentivesHistoryUseCase,
  PublishIncentivePeriodUseCase,
} from '../../src/application/incentives/incentives.use-cases';
import { UpdateStaffMemberUseCase } from '../../src/application/staff/staff.use-cases';
import { StaffMemberRecord } from '../../src/domain/repositories/records';
import { DateOnly } from '../../src/domain/shared/date-only';
import { ctxOf, D, makeMember, seed } from '../support/fixtures';
import { InMemoryUnitOfWork, TestClock } from '../support/in-memory';

/**
 * Escenario (hoy 06/11/2026, W = ago–oct con history_start_period = 2026-08 y history_months = 3):
 * - O1, O2 (socios de antes): pagan del 1 al último de jul, ago, sep, oct y nov.
 * - O3: paga jul, ago y oct (no septiembre ni noviembre).
 * - Altas: N1 ago (Cristian, renueva 10/9 y 10/10), N2 sep (Maru, no renueva), N3 sep (Aileen, renueva 19/10),
 *   N4 oct (Giovanni), N5 nov (Maru), N6 nov (sin asignar).
 * - Egresos: ago, sep y oct con alquiler y sueldos (octubre además $20.000 de "Bonos"); otros ingresos $10.000 en sep.
 * Cuentas a mano: mediana de altas 1 → estadístico 2; tasa ago–sep 5/6 = 83,33 %; vencimientos de nov 5 → mínimo 5;
 * tickets 60.000 / 50.000; bono alta 12.000; equipo 1.500 por persona; gasto 550.000; equilibrio 7 → objetivo 7;
 * resultado 120.000 antes y 31.500 después de bonos.
 */
function setup(now = '2026-11-06T15:00:00Z') {
  const s = seed();
  const clock = new TestClock(new Date(now));
  const uow = new InMemoryUnitOfWork(s.db, clock);
  const planner = new IncentivePlanner(clock);
  const at = new Date('2026-01-01T00:00:00Z');
  const setting = (key: string, value: unknown, valueType: string) =>
    s.db.settings.push({ key, value, valueType, group: 'incentives', label: key, description: null, updatedAt: at, updatedBy: null });
  setting('incentives.history_start_period', '2026-08', 'string');
  setting('incentives.history_months', 3, 'number');
  const salariesId = randomUUID();
  s.db.categories.push({ id: salariesId, type: 'EXPENSE', name: 'Sueldos y liquidaciones', isActive: true, isSystem: false, notes: null, sortOrder: 4 });

  let seq = 0;
  const pay = (memberId: string, startsOn: string, expiresOn: string, amount: number) => {
    const cashId = randomUUID();
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, seq++));
    s.db.cash.push({
      id: cashId,
      legacyCode: `P${String(seq).padStart(4, '0')}`,
      occurredOn: D(startsOn),
      type: 'INCOME',
      categoryId: s.renewalCategoryId,
      subcategory: s.plan.name,
      amount,
      description: null,
      memberId,
      origin: 'RENEWAL',
      status: 'ACTIVE',
      voidedAt: null,
      voidReason: null,
      splits: [{ method: 'CASH', amount }],
      createdById: null,
      createdAt,
      updatedAt: createdAt,
    });
    s.db.memberships.push({
      id: randomUUID(),
      legacyCode: `P${String(seq).padStart(4, '0')}`,
      memberId,
      planId: s.plan.id,
      planName: s.plan.name,
      startsOn: D(startsOn),
      expiresOn: D(expiresOn),
      amountTotal: amount,
      cashMovementId: cashId,
      status: 'ACTIVE',
      voidedAt: null,
      voidReason: null,
      notes: null,
      createdAt,
      updatedAt: createdAt,
    });
  };
  const member = (code: string, joinedAt: string, soldBy: StaffMemberRecord | null, payments: [string, string, number][]) => {
    const m = makeMember({
      legacyCode: code,
      firstName: code,
      lastName: 'Prueba',
      searchName: `${code.toLowerCase()} prueba`,
      joinedAt: D(joinedAt),
      currentPlanId: s.plan.id,
      soldByStaffId: soldBy?.id ?? null,
      lastRenewalAt: payments.length ? D(payments[payments.length - 1]![0]) : null,
      expiresAt: payments.length ? D(payments[payments.length - 1]![1]) : null,
    });
    s.db.members.push(m);
    for (const [from, to, amount] of payments) pay(m.id, from, to, amount);
    return m;
  };
  const movement = (type: 'INCOME' | 'EXPENSE', date: string, categoryId: string, amount: number, subcategory: string | null = null) => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    s.db.cash.push({
      id: randomUUID(),
      legacyCode: null,
      occurredOn: D(date),
      type,
      categoryId,
      subcategory,
      amount,
      description: null,
      memberId: null,
      origin: 'MANUAL',
      status: 'ACTIVE',
      voidedAt: null,
      voidReason: null,
      splits: [{ method: 'TRANSFER', amount }],
      createdById: null,
      createdAt,
      updatedAt: createdAt,
    });
  };

  const monthly = (months: string[]): [string, string, number][] =>
    months.map((m) => [`2026-${m}-01`, DateOnly.addDays(DateOnly.of(2026, Number(m) + 1, 1), -1), 50_000]);
  const O1 = member('O1', '2026-01-10', null, monthly(['07', '08', '09', '10', '11']));
  const O2 = member('O2', '2026-01-10', null, monthly(['07', '08', '09', '10', '11']));
  member('O3', '2026-01-10', null, monthly(['07', '08', '10']));
  const N1 = member('N1', '2026-08-10', s.staff.cristian, [
    ['2026-08-10', '2026-09-09', 60_000],
    ['2026-09-10', '2026-10-09', 50_000],
    ['2026-10-10', '2026-11-09', 50_000],
  ]);
  member('N2', '2026-09-05', s.staff.maru, [['2026-09-05', '2026-10-04', 60_000]]);
  const N3 = member('N3', '2026-09-20', s.staff.aileen, [
    ['2026-09-20', '2026-10-19', 60_000],
    ['2026-10-19', '2026-11-18', 50_000],
  ]);
  const N4 = member('N4', '2026-10-15', s.staff.giovanni, [['2026-10-15', '2026-11-14', 60_000]]);
  member('N5', '2026-11-02', s.staff.maru, [['2026-11-02', '2026-12-01', 60_000]]);
  member('N6', '2026-11-03', null, [['2026-11-03', '2026-12-02', 60_000]]);
  for (const [m, salaries] of [['08', 200_000], ['09', 250_000], ['10', 250_000]] as const) {
    movement('EXPENSE', `2026-${m}-05`, s.expenseCategoryId, 300_000);
    movement('EXPENSE', `2026-${m}-28`, salariesId, salaries);
  }
  movement('EXPENSE', '2026-10-31', salariesId, 20_000, 'Bonos');
  movement('INCOME', '2026-09-15', s.incomeCategoryId, 10_000);

  return {
    ...s,
    clock,
    uow,
    planner,
    members: { O1, O2, N1, N3, N4 },
    pay,
    member,
    history: new GetIncentivesHistoryUseCase(uow.repos, clock, planner),
    plan: new GetIncentivePlanUseCase(uow.repos, clock, planner),
    period: new GetIncentivePeriodUseCase(uow.repos, clock, planner),
    publish: new PublishIncentivePeriodUseCase(uow, clock, planner),
    close: new CloseIncentivePeriodUseCase(uow, clock, planner),
    updateStaff: new UpdateStaffMemberUseCase(uow),
  };
}

describe('Objetivos y bonos · propuesta y simulador (HU-OBJ-01)', () => {
  it('calcula la propuesta del mes en curso con los datos en vivo', async () => {
    const t = setup();
    const plan = await t.plan.execute({});
    expect(plan.period).toBe('2026-11');
    expect(plan.window).toEqual({
      periods: ['2026-08', '2026-09', '2026-10'],
      renewalRatePeriods: ['2026-08', '2026-09'],
      ticketPeriods: ['2026-08', '2026-09', '2026-10'],
      expenseReferencePeriods: ['2026-09', '2026-10'],
    });
    expect(plan.inputs).toMatchObject({
      newMembersByPeriod: [
        { period: '2026-08', count: 1 },
        { period: '2026-09', count: 2 },
        { period: '2026-10', count: 1 },
      ],
      newMembersMedian: 1,
      renewalRateHistPct: 83.3333,
      expectedExpirations: 5,
      extraRenewalPayments: 0,
      ticketNewMember: 60_000,
      ticketRenewal: 50_000,
      otherIncome: 0,
      expenseReferenceArs: 550_000, // sin los $20.000 de "Bonos" de octubre
      expenseReferenceSource: 'AUTO',
      eligibleStaff: [
        { id: t.staff.cristian.id, displayName: 'Cristian' },
        { id: t.staff.maru.id, displayName: 'Maru' },
        { id: t.staff.aileen.id, displayName: 'Aileen' },
      ],
    });
    expect(plan.targets).toMatchObject({
      newMembersStatistical: 2,
      newMembersBreakeven: 7,
      newMembers: 7,
      newMembersSource: 'BREAKEVEN',
      newMembersAchievedMonths: 0,
      renewalRateTargetPct: 83.33,
      renewals: 5,
    });
    expect(plan.amounts).toMatchObject({ bonusPerNewMemberArs: 12_000, teamBonusPerPersonArs: 1_500, teamBonusTotalArs: 4_500 });
    expect(plan.projection).toMatchObject({ incomeTotal: 670_000, expenses: 550_000, bonuses: 88_500, resultBeforeBonuses: 120_000, resultAfterBonuses: 31_500 });
    expect(plan.warnings.map((w) => w.code).sort()).toEqual([
      'DATA_GAP_PREVIOUS_MONTH',
      'PROVISIONAL_RENEWAL_DATA',
      'TARGET_ABOVE_HISTORY',
      'TARGET_RAISED_TO_BREAKEVEN',
      'UNASSIGNED_NEW_MEMBERS',
    ]);
    expect(plan.warnings.every((w) => w.message.length > 20)).toBe(true);
  });

  it('el simulador recalcula con los reemplazos y no guarda nada', async () => {
    const t = setup();
    const plan = await t.plan.execute({ newMembersTarget: 3, teamBonusPct: 6 });
    expect(plan.targets).toMatchObject({ newMembers: 3, newMembersSource: 'OVERRIDE' });
    expect(plan.amounts.teamBonusPerPersonArs).toBe(5_000); // 5 × 50.000 × 6 % / 3 = 5.000
    expect(plan.overrides).toEqual({ newMembersTarget: 3, teamBonusPct: 6 });
    expect(t.db.incentivePeriods).toHaveLength(0);
    expect(t.db.audit).toHaveLength(0);
  });

  it('permite mirar el mes siguiente (sin avance ni publicación)', async () => {
    const t = setup();
    const detail = await t.period.execute('2026-12');
    expect(detail).toMatchObject({ status: 'DRAFT', progress: null, canPublish: false, canClose: false });
    expect(detail.plan.window.periods).toEqual(['2026-08', '2026-09', '2026-10']); // noviembre todavía no cerró
    await expect(t.period.execute('2026-13')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('Objetivos y bonos · avance, publicación y cierre (HU-OBJ-02..04)', () => {
  it('sin publicar: DRAFT con la propuesta y el avance en vivo', async () => {
    const t = setup();
    const d = await t.period.execute('2026-11');
    expect(d).toMatchObject({ period: '2026-11', status: 'DRAFT', canPublish: true, canClose: false, closableFrom: '2026-12-16', publishedAt: null });
    expect(d.progress!.newMembers).toEqual({ actual: 2, target: 7, remaining: 5, achieved: false, unassigned: 1 });
    expect(d.progress!.renewals).toMatchObject({ expirations: 5, renewed: 0, pending: 5, lost: 0, ratePct: 0, required: 5, achieved: false, graceEndsOn: '2026-12-15' });
    // Todas las personas activas, en orden (Giovanni y Lucas no cobran bono).
    expect(d.progress!.staff.map((s) => [s.staff.displayName, s.isBonusEligible, s.newMembers, s.totalArs])).toEqual([
      ['Cristian', true, 0, 0],
      ['Maru', true, 1, 0],
      ['Aileen', true, 0, 0],
      ['Giovanni', false, 0, 0],
      ['Lucas', false, 0, 0],
    ]);
    expect(d.progress!.finance).toEqual({ incomeToDate: 220_000, expensesToDate: 0 });
    expect(d.progress!.newMembersList.map((m) => [m.legacyCode, m.paidOn, m.amount, m.soldBy?.displayName ?? null])).toEqual([
      ['N5', '2026-11-02', 60_000, 'Maru'],
      ['N6', '2026-11-03', 60_000, null],
    ]);
  });

  it('publicar: solo el mes en curso, congela plan y elegibles y audita PUBLISH; republicar exige replace', async () => {
    const t = setup();
    await expect(t.publish.execute(ctxOf(t.admin), '2026-10', {})).rejects.toMatchObject({ code: 'INCENTIVE_PERIOD_NOT_EDITABLE' });
    const pub = await t.publish.execute(ctxOf(t.admin), '2026-11', { notes: 'Objetivo de noviembre' });
    expect(pub).toMatchObject({ status: 'PUBLISHED', notes: 'Objetivo de noviembre', publishedBy: { id: t.admin.id }, canPublish: true });
    expect(pub.plan.targets.newMembers).toBe(7);
    expect(t.db.incentivePeriods[0]).toMatchObject({ period: '2026-11', status: 'PUBLISHED', newMembersTarget: 7, renewalsTarget: 5, bonusPerNewMemberArs: 12_000 });
    const audit = t.db.audit.at(-1)!;
    expect(audit).toMatchObject({ entity: 'INCENTIVE_PERIOD', action: 'PUBLISH', entityLabel: 'Objetivos y bonos 2026-11', userId: t.admin.id });
    expect(audit.after).toMatchObject({ newMembersTarget: 7, replaced: false });

    await expect(t.publish.execute(ctxOf(t.admin), '2026-11', {})).rejects.toMatchObject({ code: 'INCENTIVE_ALREADY_PUBLISHED' });

    // Los cambios de datos y de equipo no mueven el plan publicado.
    await t.updateStaff.execute(ctxOf(t.admin), t.staff.aileen.id, { isActive: false });
    t.member('N7', '2026-11-05', t.staff.cristian, [['2026-11-05', '2026-12-04', 90_000]]);
    const live = await t.period.execute('2026-11');
    expect(live.plan.inputs.eligibleStaff.map((s) => s.displayName)).toEqual(['Cristian', 'Maru', 'Aileen']);
    expect(live.plan.inputs.ticketNewMember).toBe(60_000);
    expect(live.progress!.newMembers.actual).toBe(3);

    const again = await t.publish.execute(ctxOf(t.admin), '2026-11', { replace: true, overrides: { newMembersTarget: 8 } });
    expect(again.plan.targets).toMatchObject({ newMembers: 8, newMembersSource: 'OVERRIDE' });
    expect(again.plan.inputs.eligibleStaff.map((s) => s.displayName)).toEqual(['Cristian', 'Maru']);
    expect(t.db.incentivePeriods).toHaveLength(1);
    expect(t.db.audit.at(-1)!.after).toMatchObject({ replaced: true, newMembersTarget: 8 });
  });

  it('resultado negativo después de bonos: 409 INCENTIVE_RESULT_NEGATIVE salvo que se acepte', async () => {
    const t = setup();
    await expect(t.publish.execute(ctxOf(t.admin), '2026-11', { overrides: { newMembersTarget: 1 } })).rejects.toMatchObject({
      kind: 'CONFLICT',
      code: 'INCENTIVE_RESULT_NEGATIVE',
    });
    expect(t.db.incentivePeriods).toHaveLength(0);
    const pub = await t.publish.execute(ctxOf(t.admin), '2026-11', { overrides: { newMembersTarget: 1 }, acceptNegativeResult: true });
    expect(pub.plan.acceptedNegativeResult).toBe(true);
    expect(pub.plan.projection.resultAfterBonuses).toBe(-256_500);
  });

  it('cerrar: 409 si no se publicó o si la gracia está pendiente; desde el 16/12 liquida con la lista congelada', async () => {
    const t = setup();
    await expect(t.close.execute(ctxOf(t.admin), '2026-11', {})).rejects.toMatchObject({ code: 'INCENTIVE_NOT_PUBLISHED' });
    await t.publish.execute(ctxOf(t.admin), '2026-11', {});
    await expect(t.close.execute(ctxOf(t.admin), '2026-11', {})).rejects.toMatchObject({
      code: 'INCENTIVE_GRACE_PENDING',
      details: [expect.objectContaining({ value: '2026-12-16' })],
    });

    // Aileen se desactiva después de publicar: igual cobra (lista congelada).
    await t.updateStaff.execute(ctxOf(t.admin), t.staff.aileen.id, { isActive: false });
    // Llegan a 7 altas y renuevan los 5 vencimientos de noviembre dentro de la gracia.
    t.member('N7', '2026-11-10', t.staff.cristian, [['2026-11-10', '2026-12-09', 60_000]]);
    t.member('N8', '2026-11-11', t.staff.cristian, [['2026-11-11', '2026-12-10', 60_000]]);
    t.member('N9', '2026-11-12', t.staff.cristian, [['2026-11-12', '2026-12-11', 60_000]]);
    t.member('N10', '2026-11-13', t.staff.aileen, [['2026-11-13', '2026-12-12', 60_000]]);
    t.member('N11', '2026-11-14', t.staff.lucas, [['2026-11-14', '2026-12-13', 60_000]]);
    t.pay(t.members.O1.id, '2026-12-01', '2026-12-31', 50_000);
    t.pay(t.members.O2.id, '2026-12-15', '2027-01-14', 50_000);
    t.pay(t.members.N1.id, '2026-11-10', '2026-12-09', 50_000);
    t.pay(t.members.N3.id, '2026-11-20', '2026-12-19', 50_000);
    t.pay(t.members.N4.id, '2026-11-25', '2026-12-24', 50_000);

    t.clock.current = new Date('2026-12-15T15:00:00Z');
    await expect(t.close.execute(ctxOf(t.admin), '2026-11', {})).rejects.toMatchObject({ code: 'INCENTIVE_GRACE_PENDING' });
    t.clock.current = new Date('2026-12-16T15:00:00Z');
    const closed = await t.close.execute(ctxOf(t.admin), '2026-11', { notes: 'Pagado el 16/12' });
    expect(closed).toMatchObject({ status: 'CLOSED', canPublish: false, canClose: true, closedBy: { id: t.admin.id }, notes: 'Cierre: Pagado el 16/12' });
    const r = closed.progress!;
    expect(r.isFinal).toBe(true);
    expect(r.newMembers).toEqual({ actual: 7, target: 7, remaining: 0, achieved: true, unassigned: 1 });
    expect(r.renewals).toMatchObject({ expirations: 5, renewed: 5, required: 5, achieved: true, lost: 0 });
    expect(r.staff.map((s) => [s.staff.displayName, s.isBonusEligible, s.newMembers, s.newMemberBonusArs, s.teamBonusArs, s.totalArs])).toEqual([
      ['Cristian', true, 3, 36_000, 1_500, 37_500],
      ['Maru', true, 1, 12_000, 1_500, 13_500],
      ['Aileen', true, 1, 12_000, 1_500, 13_500],
      ['Giovanni', false, 0, 0, 0, 0],
      ['Lucas', false, 1, 0, 0, 0],
    ]);
    expect(r.totals).toEqual({ newMemberBonusesArs: 60_000, teamBonusesArs: 4_500, totalArs: 64_500, capApplied: false });
    const hist = await t.history.execute({ from: '2026-11', to: '2026-11' });
    expect(hist.months[0]!.incentive).toEqual({
      status: 'CLOSED',
      newMembersTarget: 7,
      renewalRateTargetPct: 83.33,
      renewalsTarget: 5,
      newMembersAchieved: true,
      renewalsAchieved: true,
      totalBonusesArs: 64_500,
    });
    expect(t.db.incentivePeriods[0]).toMatchObject({ status: 'CLOSED', closedById: t.admin.id });
    expect(t.db.audit.at(-1)).toMatchObject({ entity: 'INCENTIVE_PERIOD', action: 'CLOSE_PERIOD' });

    // Cerrado: el resultado queda congelado aunque cambien los datos.
    t.member('N12', '2026-11-20', t.staff.maru, [['2026-11-20', '2026-12-19', 60_000]]);
    const frozen = await t.period.execute('2026-11');
    expect(frozen.progress!.newMembers.actual).toBe(7);
    expect(frozen.progress!.totals.totalArs).toBe(64_500);

    await expect(t.close.execute(ctxOf(t.admin), '2026-11', {})).rejects.toMatchObject({ code: 'INCENTIVE_PERIOD_CLOSED' });
    await expect(t.publish.execute(ctxOf(t.admin), '2026-11', { replace: true })).rejects.toMatchObject({ code: 'INCENTIVE_PERIOD_CLOSED' });
    const recalculated = await t.close.execute(ctxOf(t.admin), '2026-11', { replace: true });
    expect(recalculated.progress!.newMembers.actual).toBe(8);
    expect(recalculated.progress!.totals.totalArs).toBe(76_500);
  });
});

describe('Objetivos y bonos · histórico (HU-OBJ-05)', () => {
  it('mes a mes: altas por persona, renovaciones, gastos completos, margen y el objetivo publicado', async () => {
    const t = setup();
    await t.publish.execute(ctxOf(t.admin), '2026-11', {});
    const h = await t.history.execute({ from: '2026-07' });
    expect(h).toMatchObject({ from: '2026-07', to: '2026-11', cutoverPeriod: '2026-11' });
    expect(h.months.map((m) => m.period)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    const [jul, aug, sep, oct, nov] = h.months;
    expect(jul).toMatchObject({ isBeforeHistoryStart: true, attributionApproximate: true, expirations: null, renewed: null, renewalRatePct: null, expensesComplete: false, incentive: null });
    expect(aug).toMatchObject({
      isBeforeHistoryStart: false,
      newMembers: 1,
      newMembersAmount: 60_000,
      newMembersByStaff: [{ staff: { id: t.staff.cristian.id, displayName: 'Cristian' }, count: 1 }],
      newMembersUnassigned: 0,
      renewalPayments: 3,
      renewalPaymentsAmount: 150_000,
      expirations: 3,
      renewed: 2,
      renewalRatePct: 66.67,
      renewalIsFinal: true,
      expenses: 500_000,
      expensesComplete: true,
      margin: -290_000,
    });
    expect(sep!.newMembersByStaff.map((x) => x.staff.displayName)).toEqual(['Maru', 'Aileen']);
    expect(sep!.otherIncome).toBe(10_000);
    expect(oct).toMatchObject({ expenses: 570_000, expensesComplete: true, renewalIsFinal: false, expirations: 6, renewed: 4, margin: -260_000 });
    expect(nov).toMatchObject({
      attributionApproximate: false,
      newMembers: 2,
      newMembersUnassigned: 1,
      incentive: { status: 'PUBLISHED', newMembersTarget: 7, renewalRateTargetPct: 83.33, renewalsTarget: 5, newMembersAchieved: null, renewalsAchieved: null, totalBonusesArs: null },
    });
    const byDefault = await t.history.execute({});
    expect(byDefault.from).toBe('2026-08');
    await expect(t.history.execute({ from: '2026-11', to: '2026-10' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
