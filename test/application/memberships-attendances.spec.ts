import { CreateAttendanceUseCase } from '../../src/application/attendances/attendances.use-cases';
import { CreateMemberUseCase, RunAutoCancellationsUseCase } from '../../src/application/members/members.use-cases';
import { MembershipService } from '../../src/application/memberships/membership-service';
import { CreateMembershipUseCase, UpdateMembershipUseCase, VoidMembershipUseCase } from '../../src/application/memberships/memberships.use-cases';
import { JobRunner } from '../../src/application/jobs/job-runner';
import { SplitInput } from '../../src/domain/cash/splits';
import { systemContext } from '../../src/domain/shared/request-context';
import { ctxOf, D, makeMember, seed } from '../support/fixtures';
import { InMemoryUnitOfWork, TestClock } from '../support/in-memory';

function setup(now = '2026-10-26T15:00:00Z') {
  const s = seed();
  const clock = new TestClock(new Date(now));
  const uow = new InMemoryUnitOfWork(s.db, clock);
  const service = new MembershipService(clock);
  const member = makeMember({ currentPlanId: s.plan.id });
  s.db.members.push(member);
  return {
    ...s,
    clock,
    uow,
    member,
    renew: new CreateMembershipUseCase(uow, clock, service),
    update: new UpdateMembershipUseCase(uow, clock, service),
    voidM: new VoidMembershipUseCase(uow, clock, service),
    createMember: new CreateMemberUseCase(uow, clock, service),
    checkIn: new CreateAttendanceUseCase(uow, clock),
    autoCancel: new RunAutoCancellationsUseCase(uow, clock, new JobRunner(uow, clock)),
  };
}

const payment = (planId: string, paidOn: string, expiresOn: string, splits: SplitInput[] = [{ method: 'CASH', amount: 45000 }]) => ({
  planId,
  paidOn,
  expiresOn,
  splits,
});

describe('Renovaciones (HU-REN-01..03)', () => {
  it('renovar crea membresía + movimiento RENEWAL con splits y actualiza vencimiento, plan y última renovación', async () => {
    const t = setup();
    const res = await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-01', '2026-10-31', [
      { method: 'CASH', amount: 15000 },
      { method: 'MERCADOPAGO', amount: 30000 },
    ]));
    expect(res.membership).toMatchObject({ legacyCode: 'P0504', amountTotal: 45000, startsOn: '2026-10-01', expiresOn: '2026-10-31' });
    expect(res.membership.splits).toHaveLength(2);
    expect(res.member).toMatchObject({ lastRenewalAt: '2026-10-01', expiresAt: '2026-10-31', currentPlan: { id: t.plan.id } });
    const cash = t.db.cash[0]!;
    expect(cash).toMatchObject({
      origin: 'RENEWAL',
      type: 'INCOME',
      categoryId: t.renewalCategoryId,
      subcategory: t.plan.name,
      description: `Renovación ${t.plan.name} – Juan Pérez`,
      amount: 45000,
    });
    expect(t.db.audit.map((a) => `${a.action} ${a.entity}`)).toEqual(['CREATE MEMBERSHIP', 'CREATE CASH_MOVEMENT', 'UPDATE MEMBER']);
    expect(res.warnings).toEqual([]);
  });

  it('una carga retroactiva se acepta, no retrocede el vencimiento y devuelve warnings', async () => {
    const t = setup();
    await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-01', '2026-10-31'));
    const retro = await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-09-01', '2026-09-30'));
    expect(retro.warnings[0]).toMatch(/Carga retroactiva/);
    expect(retro.member.expiresAt).toBe('2026-10-31');
  });

  it('anular la vigente devuelve al socio a la membresía anterior; anular la última deja el vencimiento nulo', async () => {
    const t = setup();
    const sept = await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-09-01', '2026-09-30'));
    const oct = await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-01', '2026-10-31'));
    expect(oct.member.expiresAt).toBe('2026-10-31');

    const voided = await t.voidM.execute(ctxOf(t.admin), oct.membership.id, { reason: 'Cobro duplicado' });
    expect(voided.status).toBe('VOIDED');
    expect(t.db.cash.find((c) => c.id === oct.membership.cashMovementId)!.status).toBe('VOIDED');
    let member = t.db.members.find((m) => m.id === t.member.id)!;
    expect(member.expiresAt).toBe('2026-09-30');
    expect(member.lastRenewalAt).toBe('2026-09-01');

    await expect(t.voidM.execute(ctxOf(t.admin), oct.membership.id, { reason: 'otra vez' })).rejects.toMatchObject({ code: 'RECORD_VOIDED' });

    await t.voidM.execute(ctxOf(t.admin), sept.membership.id, { reason: 'Error de carga' });
    member = t.db.members.find((m) => m.id === t.member.id)!;
    expect(member.expiresAt).toBeNull();
    expect(member.lastRenewalAt).toBeNull();
  });

  it('editar la vigente recalcula el movimiento y el vencimiento del socio', async () => {
    const t = setup();
    const oct = await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-01', '2026-10-31'));
    const edited = await t.update.execute(ctxOf(t.recep), oct.membership.id, {
      expiresOn: '2026-11-15',
      splits: [{ method: 'DEBIT', amount: 50000 }],
    });
    expect(edited).toMatchObject({ expiresOn: '2026-11-15', amountTotal: 50000, splits: [{ method: 'DEBIT', amount: 50000 }] });
    expect(t.db.cash[0]).toMatchObject({ amount: 50000 });
    expect(t.db.members.find((m) => m.id === t.member.id)!.expiresAt).toBe('2026-11-15');
  });

  it('renovar a un socio de baja lo reactiva con evento REACTIVATED', async () => {
    const t = setup();
    Object.assign(t.member, { status: 'CANCELLED', cancelledAt: D('2026-09-20'), cancellationReason: 'Baja voluntaria' });
    t.db.events.push({ id: 'e1', memberId: t.member.id, type: 'CANCELLED', effectiveOn: D('2026-09-20'), reason: 'Baja voluntaria', createdBy: null, createdAt: new Date() });
    const res = await t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-26', '2026-11-25'));
    expect(res.member.status).toBe('ACTIVE');
    expect(res.member.cancellationReason).toBe('Baja voluntaria'); // el historial no se borra
    expect(t.db.events.map((e) => [e.type, e.effectiveOn])).toEqual([
      ['CANCELLED', '2026-09-20'],
      ['REACTIVATED', '2026-10-26'],
    ]);
    expect(t.db.audit.some((a) => a.action === 'REACTIVATE')).toBe(true);
  });

  it('si la validación del pago falla no queda nada escrito (transacción)', async () => {
    const t = setup();
    await expect(
      t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-01', '2026-09-01')),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      t.renew.execute(ctxOf(t.recep), t.member.id, payment(t.plan.id, '2026-10-01', '2026-10-31', [
        { method: 'CASH', amount: 10 },
        { method: 'CASH', amount: 20 },
      ])),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(t.db.memberships).toHaveLength(0);
    expect(t.db.cash).toHaveLength(0);
    expect(t.db.audit).toHaveLength(0);
  });
});

describe('Alta de socio con pago inicial (HU-SOC-02)', () => {
  it('crea socio LB###, evento de alta, membresía y movimiento con pago dividido', async () => {
    const t = setup();
    const res = await t.createMember.execute(ctxOf(t.recep), {
      firstName: '  Ana ',
      lastName: 'Gómez',
      phone: '11 4444 5555',
      planId: t.plan.id,
      initialPayment: payment(t.plan.id, '2026-10-20', '2026-11-19', [
        { method: 'CASH', amount: 20000 },
        { method: 'TRANSFER', amount: 25000 },
      ]),
    });
    expect(res.member).toMatchObject({ legacyCode: 'LB191', fullName: 'Ana Gómez', joinedAt: '2026-10-20', expiresAt: '2026-11-19', phoneE164: '+5491144445555' });
    expect(res.membership?.splits).toHaveLength(2);
    await expect(
      t.createMember.execute(ctxOf(t.recep), { firstName: 'ANA', lastName: 'gomez', phone: '1144445555', planId: t.plan.id }),
    ).rejects.toMatchObject({ code: 'MEMBER_NAME_EXISTS', details: [expect.objectContaining({ field: 'existingLegacyCode', value: 'LB191' })] });
  });
});

describe('Check-in (HU-ASI-01)', () => {
  it('usa la hora del servidor y calcula checked_in_on en Buenos Aires', async () => {
    const t = setup('2026-10-27T01:30:00Z'); // 26/10 22:30 en BA
    const a = await t.checkIn.execute(ctxOf(t.recep), { memberId: t.member.id });
    expect(a).toMatchObject({ checkedInAt: '2026-10-27T01:30:00.000Z', checkedInOn: '2026-10-26', source: 'WEB' });
  });

  it('un segundo check-in el mismo día responde 409 DUPLICATE_CHECKIN salvo force', async () => {
    const t = setup();
    const first = await t.checkIn.execute(ctxOf(t.recep), { memberId: t.member.id });
    t.clock.advanceMinutes(90);
    await expect(t.checkIn.execute(ctxOf(t.recep), { memberId: t.member.id })).rejects.toMatchObject({
      kind: 'CONFLICT',
      code: 'DUPLICATE_CHECKIN',
      details: [expect.objectContaining({ field: 'existingCheckedInAt', value: first.checkedInAt })],
    });
    const forced = await t.checkIn.execute(ctxOf(t.recep), { memberId: t.member.id, force: true });
    expect(forced.id).not.toBe(first.id);
    expect(t.db.attendances).toHaveLength(2);
  });

  it('la carga manual exige nota y un socio de baja no puede registrar asistencia', async () => {
    const t = setup();
    await expect(t.checkIn.execute(ctxOf(t.recep), { memberId: t.member.id, checkedInAt: '2026-10-20T12:00:00-03:00' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const manual = await t.checkIn.execute(ctxOf(t.recep), {
      memberId: t.member.id,
      checkedInAt: '2026-10-20T12:00:00-03:00',
      notes: 'Se olvidó de registrar',
    });
    expect(manual).toMatchObject({ source: 'MANUAL', checkedInOn: '2026-10-20' });
    t.member.status = 'CANCELLED';
    await expect(t.checkIn.execute(ctxOf(t.recep), { memberId: t.member.id })).rejects.toMatchObject({ code: 'MEMBER_CANCELLED' });
  });
});

describe('Baja automática (HU-SOC-05)', () => {
  it('da de baja con evento AUTO_CANCELLED, auditoría a nombre de system y registro en job_runs', async () => {
    const t = setup();
    Object.assign(t.member, { expiresAt: D('2026-10-10') }); // 16 días vencido
    const otro = makeMember({ legacyCode: 'LB046', searchName: 'otro socio', expiresAt: D('2026-10-11') }); // 15 días
    t.db.members.push(otro);
    const res = await t.autoCancel.execute(systemContext());
    expect(res).toMatchObject({ applied: 1, thresholdDays: 15, members: [{ legacyCode: 'LB045', expiresAt: '2026-10-10' }] });
    const m = t.db.members.find((x) => x.id === t.member.id)!;
    expect(m).toMatchObject({ status: 'CANCELLED', cancelledAt: '2026-10-26', cancellationReason: 'Baja automática por inactividad' });
    expect(t.db.events.at(-1)).toMatchObject({ type: 'AUTO_CANCELLED', effectiveOn: '2026-10-26' });
    expect(t.db.audit.at(-1)).toMatchObject({ action: 'CANCEL', actorLabel: 'system', userId: null });
    expect(t.db.jobRuns.at(-1)).toMatchObject({ job: 'AUTO_CANCEL_MEMBERS', status: 'OK', result: expect.objectContaining({ applied: 1 }) });
  });
});
