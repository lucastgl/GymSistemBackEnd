import { PasswordConfirmationService } from '../../src/application/auth/password-confirmation';
import {
  CreateCashMovementUseCase,
  ListCashMovementsUseCase,
  UpdateCashMovementUseCase,
  VoidCashMovementUseCase,
} from '../../src/application/cash/cash.use-cases';
import { CashFilter } from '../../src/domain/repositories/repositories';
import { InMemoryAttemptLimiter } from '../../src/infrastructure/security/security-adapters';
import { ctxOf, D, seed } from '../support/fixtures';
import { FakeHasher, InMemoryUnitOfWork, TestClock } from '../support/in-memory';

function setup() {
  const s = seed();
  const clock = new TestClock(new Date('2026-10-26T15:00:00Z'));
  const uow = new InMemoryUnitOfWork(s.db, clock);
  const limiter = new InMemoryAttemptLimiter(() => clock.now().getTime());
  const confirmation = new PasswordConfirmationService(uow.repos, new FakeHasher(), limiter);
  return {
    ...s,
    clock,
    uow,
    create: new CreateCashMovementUseCase(uow.repos, uow, clock, confirmation),
    update: new UpdateCashMovementUseCase(uow.repos, uow, clock, confirmation),
    voidMv: new VoidCashMovementUseCase(uow.repos, uow, clock, confirmation),
    list: new ListCashMovementsUseCase(uow.repos, clock),
  };
}

const expense = (categoryId: string, confirmPassword?: string) => ({
  type: 'EXPENSE' as const,
  categoryId,
  amount: 120000,
  splits: [{ method: 'TRANSFER' as const, amount: 120000 }],
  description: 'Pago de alquiler de octubre',
  confirmPassword,
});

describe('Egresos con confirmación de contraseña (D5, HU-CAJA-03/04)', () => {
  it('con la contraseña correcta registra el egreso a nombre del usuario y audita passwordConfirmed', async () => {
    const t = setup();
    const mv = await t.create.execute(ctxOf(t.recep), expense(t.expenseCategoryId, 'Mariel123456'));
    expect(mv).toMatchObject({ type: 'EXPENSE', amount: 120000, legacyCode: 'MV0085', origin: 'MANUAL' });
    expect(t.db.cash[0]!.createdById).toBe(t.recep.id);
    const audit = t.db.audit.find((a) => a.entity === 'CASH_MOVEMENT')!;
    expect(audit).toMatchObject({ action: 'CREATE', passwordConfirmed: true, userId: t.recep.id, actorLabel: 'Mariel' });
    expect(JSON.stringify(audit)).not.toContain('Mariel123456');
    expect(JSON.stringify(audit)).not.toContain('confirmPassword');
  });

  it('con la contraseña de otro o incorrecta responde 403 PASSWORD_CONFIRMATION_INVALID y no registra nada', async () => {
    const t = setup();
    await expect(t.create.execute(ctxOf(t.recep), expense(t.expenseCategoryId, 'Secreta123456'))).rejects.toMatchObject({
      kind: 'FORBIDDEN',
      code: 'PASSWORD_CONFIRMATION_INVALID',
    });
    expect(t.db.cash).toHaveLength(0);
    expect(t.db.audit).toHaveLength(0);
  });

  it('sin contraseña es un error de validación (400)', async () => {
    const t = setup();
    await expect(t.create.execute(ctxOf(t.recep), expense(t.expenseCategoryId))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('5 confirmaciones fallidas en 15 minutos bloquean (429) aun con la contraseña correcta', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      await expect(t.create.execute(ctxOf(t.recep), expense(t.expenseCategoryId, `mala-${i}`))).rejects.toMatchObject({
        code: 'PASSWORD_CONFIRMATION_INVALID',
      });
    }
    await expect(t.create.execute(ctxOf(t.recep), expense(t.expenseCategoryId, 'Mariel123456'))).rejects.toMatchObject({
      kind: 'TOO_MANY_REQUESTS',
    });
    expect(t.db.cash).toHaveLength(0);
    t.clock.advanceMinutes(16);
    await expect(t.create.execute(ctxOf(t.recep), expense(t.expenseCategoryId, 'Mariel123456'))).resolves.toHaveProperty('id');
  });

  it('editar y anular un egreso también exigen la contraseña; un ingreso no', async () => {
    const t = setup();
    const mv = await t.create.execute(ctxOf(t.admin), expense(t.expenseCategoryId, 'Secreta123456'));
    await expect(t.update.execute(ctxOf(t.admin), mv.id, { amount: 130000, confirmPassword: 'mala' })).rejects.toMatchObject({
      code: 'PASSWORD_CONFIRMATION_INVALID',
    });
    const edited = await t.update.execute(ctxOf(t.admin), mv.id, { amount: 130000, confirmPassword: 'Secreta123456' });
    expect(edited.amount).toBe(130000);
    expect(edited.splits).toEqual([{ method: 'TRANSFER', amount: 130000 }]);
    const voided = await t.voidMv.execute(ctxOf(t.admin), mv.id, { reason: 'Cargado dos veces', confirmPassword: 'Secreta123456' });
    expect(voided.status).toBe('VOIDED');
    expect(t.db.audit.filter((a) => a.entity === 'CASH_MOVEMENT').map((a) => [a.action, a.passwordConfirmed])).toEqual([
      ['CREATE', true],
      ['UPDATE', true],
      ['VOID', true],
    ]);

    const income = await t.create.execute(ctxOf(t.recep), {
      type: 'INCOME',
      categoryId: t.incomeCategoryId,
      amount: 3000,
      splits: [{ method: 'CASH', amount: 3000 }],
    });
    expect(income.type).toBe('INCOME');
  });

  it('la categoría de sistema no se usa en manuales y un movimiento RENEWAL se edita/anula desde la renovación', async () => {
    const t = setup();
    await expect(
      t.create.execute(ctxOf(t.recep), { type: 'INCOME', categoryId: t.renewalCategoryId, amount: 10, splits: [{ method: 'CASH', amount: 10 }] }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_ALLOWED' });
    t.db.cash.push({
      id: '11111111-1111-4111-8111-111111111111',
      legacyCode: 'P0504',
      occurredOn: D('2026-10-20'),
      type: 'INCOME',
      categoryId: t.renewalCategoryId,
      subcategory: 'Plus',
      amount: 45000,
      description: 'Renovación',
      memberId: null,
      origin: 'RENEWAL',
      status: 'ACTIVE',
      voidedAt: null,
      voidReason: null,
      splits: [{ method: 'CASH', amount: 45000 }],
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(t.update.execute(ctxOf(t.recep), '11111111-1111-4111-8111-111111111111', { amount: 1 })).rejects.toMatchObject({
      code: 'EDIT_VIA_MEMBERSHIP',
    });
    await expect(t.voidMv.execute(ctxOf(t.recep), '11111111-1111-4111-8111-111111111111', { reason: 'error' })).rejects.toMatchObject({
      code: 'VOID_VIA_MEMBERSHIP',
    });
  });
});

describe('Totales de caja (03 §5)', () => {
  it('el caso de uso pide la página y los totales al repositorio con el MISMO filtro', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      await t.create.execute(ctxOf(t.recep), {
        type: 'INCOME',
        categoryId: t.incomeCategoryId,
        amount: 1000 * (i + 1),
        splits: [{ method: 'CASH', amount: 1000 * (i + 1) }],
        occurredOn: '2026-10-1' + i,
      });
    }
    const listSpy = jest.spyOn(t.uow.repos.cash, 'list');
    const totalsSpy = jest.spyOn(t.uow.repos.cash, 'totals');
    const res = await t.list.execute({ type: 'INCOME', method: 'CASH', q: '  ', page: 1, pageSize: 1, expandSplits: true });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(totalsSpy).toHaveBeenCalledTimes(1);
    const listFilter = listSpy.mock.calls[0]![0] as CashFilter;
    expect(totalsSpy.mock.calls[0]![0]).toBe(listFilter);
    expect(listFilter).toMatchObject({ from: '2026-10-01', to: '2026-10-31', type: 'INCOME', method: 'CASH', status: 'ACTIVE', q: null });
    // La página tiene 1 fila pero los totales cubren todo el conjunto filtrado.
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(3);
    expect(res.totals).toMatchObject({ income: 6000, expense: 0, net: 6000, count: 3 });
    expect(res.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});
