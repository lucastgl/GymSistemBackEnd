import { CreateMemberUseCase, GetMemberDetailUseCase, UpdateMemberUseCase } from '../../src/application/members/members.use-cases';
import { MembershipService } from '../../src/application/memberships/membership-service';
import {
  CreateStaffMemberUseCase,
  ListStaffMembersUseCase,
  ListStaffOptionsUseCase,
  UpdateStaffMemberUseCase,
} from '../../src/application/staff/staff.use-cases';
import { ctxOf, makeMember, makeUser, seed } from '../support/fixtures';
import { InMemoryUnitOfWork, TestClock } from '../support/in-memory';

function setup() {
  const s = seed();
  const clock = new TestClock(new Date('2026-11-06T15:00:00Z'));
  const uow = new InMemoryUnitOfWork(s.db, clock);
  const service = new MembershipService(clock);
  const other = makeUser({ email: 'otra@limitbreaker.test', fullName: 'Otra Recepcionista', role: 'RECEPCIONISTA' });
  s.db.users.push(other);
  return {
    ...s,
    clock,
    uow,
    other,
    list: new ListStaffMembersUseCase(uow.repos),
    options: new ListStaffOptionsUseCase(uow.repos),
    create: new CreateStaffMemberUseCase(uow),
    update: new UpdateStaffMemberUseCase(uow),
    createMember: new CreateMemberUseCase(uow, clock, service),
    updateMember: new UpdateMemberUseCase(uow, clock),
    detail: new GetMemberDetailUseCase(uow.repos, clock),
  };
}

const newMember = (planId: string, extra: Record<string, unknown> = {}) => ({
  firstName: 'Ana',
  lastName: 'Gómez',
  phone: '11 4444 5555',
  planId,
  ...extra,
});

describe('Equipo (HU-OBJ-06)', () => {
  it('lista por orden; por defecto solo activas, con includeInactive todas', async () => {
    const t = setup();
    await t.update.execute(ctxOf(t.admin), t.staff.giovanni.id, { isActive: false });
    expect((await t.list.execute({})).map((s) => s.displayName)).toEqual(['Cristian', 'Maru', 'Aileen', 'Lucas']);
    const all = await t.list.execute({ includeInactive: true });
    expect(all.map((s) => s.displayName)).toEqual(['Cristian', 'Maru', 'Aileen', 'Giovanni', 'Lucas']);
    expect(all.find((s) => s.displayName === 'Maru')).toMatchObject({ user: { id: t.recep.id, fullName: 'Mariel' }, isBonusEligible: true });
  });

  it('options: solo activas, sin datos de bono, marca a la persona del usuario logueado', async () => {
    const t = setup();
    await t.update.execute(ctxOf(t.admin), t.staff.aileen.id, { isActive: false });
    const opts = await t.options.execute(ctxOf(t.recep));
    expect(opts).toEqual([
      { id: t.staff.cristian.id, displayName: 'Cristian', isCurrentUser: false },
      { id: t.staff.maru.id, displayName: 'Maru', isCurrentUser: true },
      { id: t.staff.giovanni.id, displayName: 'Giovanni', isCurrentUser: false },
      { id: t.staff.lucas.id, displayName: 'Lucas', isCurrentUser: false },
    ]);
  });

  it('alta con usuario vinculado y auditoría; nombre repetido (sin mayúsculas) → 409 STAFF_NAME_EXISTS', async () => {
    const t = setup();
    const created = await t.create.execute(ctxOf(t.admin), { displayName: '  Ludmila ', userId: t.other.id, isBonusEligible: true, sortOrder: 6 });
    expect(created).toMatchObject({ displayName: 'Ludmila', user: { id: t.other.id }, isBonusEligible: true, isActive: true, sortOrder: 6 });
    expect(t.db.audit.at(-1)).toMatchObject({ entity: 'STAFF_MEMBER', action: 'CREATE', entityLabel: 'Ludmila' });
    await expect(t.create.execute(ctxOf(t.admin), { displayName: 'maru' })).rejects.toMatchObject({ kind: 'CONFLICT', code: 'STAFF_NAME_EXISTS' });
  });

  it('usuario ya vinculado a otra persona → 409 STAFF_USER_LINKED; usuario inexistente → 400', async () => {
    const t = setup();
    await expect(t.create.execute(ctxOf(t.admin), { displayName: 'Nueva', userId: t.recep.id })).rejects.toMatchObject({
      code: 'STAFF_USER_LINKED',
    });
    await expect(t.update.execute(ctxOf(t.admin), t.staff.aileen.id, { userId: t.admin.id })).rejects.toMatchObject({
      code: 'STAFF_USER_LINKED',
    });
    await expect(
      t.create.execute(ctxOf(t.admin), { displayName: 'Nueva', userId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: [expect.objectContaining({ field: 'userId' })] });
  });

  it('editar audita antes/después; sin cambios no audita; inexistente → 404', async () => {
    const t = setup();
    const before = t.db.audit.length;
    await t.update.execute(ctxOf(t.admin), t.staff.aileen.id, { isActive: true, sortOrder: 3 });
    expect(t.db.audit).toHaveLength(before);
    const updated = await t.update.execute(ctxOf(t.admin), t.staff.giovanni.id, { isBonusEligible: true, notes: 'Desde diciembre' });
    expect(updated).toMatchObject({ isBonusEligible: true, notes: 'Desde diciembre' });
    expect(t.db.audit.at(-1)).toMatchObject({ entity: 'STAFF_MEMBER', action: 'UPDATE', changedFields: ['isBonusEligible', 'notes'] });
    await expect(t.update.execute(ctxOf(t.admin), '00000000-0000-4000-8000-000000000000', { isActive: false })).rejects.toMatchObject({
      kind: 'NOT_FOUND',
    });
  });
});

describe('"Vendido por" en socios (HU-SOC-02/03)', () => {
  it('alta sin soldByStaffId: usa la persona vinculada al usuario logueado y lo audita', async () => {
    const t = setup();
    const res = await t.createMember.execute(ctxOf(t.recep), newMember(t.plan.id));
    expect(res.member.soldBy).toEqual({ id: t.staff.maru.id, displayName: 'Maru' });
    const audit = t.db.audit.find((a) => a.entity === 'MEMBER' && a.action === 'CREATE')!;
    expect(audit.after).toMatchObject({ soldByStaffId: t.staff.maru.id, soldByName: 'Maru' });
    const admin = await t.createMember.execute(ctxOf(t.admin), newMember(t.plan.id, { firstName: 'Beto' }));
    expect(admin.member.soldBy?.displayName).toBe('Lucas');
  });

  it('alta con soldByStaffId explícito (Aileen, sin usuario)', async () => {
    const t = setup();
    const res = await t.createMember.execute(ctxOf(t.recep), newMember(t.plan.id, { soldByStaffId: t.staff.aileen.id }));
    expect(res.member.soldBy).toEqual({ id: t.staff.aileen.id, displayName: 'Aileen' });
  });

  it('usuario sin persona vinculada y sin soldByStaffId → 400 VALIDATION_ERROR en soldByStaffId (no crea nada)', async () => {
    const t = setup();
    await expect(t.createMember.execute(ctxOf(t.other), newMember(t.plan.id))).rejects.toMatchObject({
      kind: 'VALIDATION',
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'soldByStaffId' })],
    });
    expect(t.db.members).toHaveLength(0);
    expect(t.db.seq.member).toBe(190);
  });

  it('persona inactiva → 400 STAFF_INACTIVE; persona inexistente → 400 VALIDATION_ERROR', async () => {
    const t = setup();
    await t.update.execute(ctxOf(t.admin), t.staff.cristian.id, { isActive: false });
    await expect(t.createMember.execute(ctxOf(t.recep), newMember(t.plan.id, { soldByStaffId: t.staff.cristian.id }))).rejects.toMatchObject({
      kind: 'VALIDATION',
      code: 'STAFF_INACTIVE',
      details: [expect.objectContaining({ field: 'soldByStaffId' })],
    });
    await t.update.execute(ctxOf(t.admin), t.staff.maru.id, { isActive: false });
    await expect(t.createMember.execute(ctxOf(t.recep), newMember(t.plan.id))).rejects.toMatchObject({ code: 'STAFF_INACTIVE' });
    await expect(
      t.createMember.execute(ctxOf(t.recep), newMember(t.plan.id, { soldByStaffId: '00000000-0000-4000-8000-000000000000' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('edición: RECEPCIONISTA no puede cambiar "Vendido por" (403 FORBIDDEN) pero sí el resto', async () => {
    const t = setup();
    const member = makeMember({ currentPlanId: t.plan.id, soldByStaffId: t.staff.maru.id });
    t.db.members.push(member);
    await expect(t.updateMember.execute(ctxOf(t.recep), member.id, { soldByStaffId: t.staff.cristian.id })).rejects.toMatchObject({
      kind: 'FORBIDDEN',
      code: 'FORBIDDEN',
    });
    await expect(t.updateMember.execute(ctxOf(t.recep), member.id, { soldByStaffId: null })).rejects.toMatchObject({ kind: 'FORBIDDEN' });
    const ok = await t.updateMember.execute(ctxOf(t.recep), member.id, { notes: 'Prefiere turno mañana' });
    expect(ok.soldBy?.displayName).toBe('Maru');
  });

  it('edición: ADMIN reasigna (auditado en la foto del socio) y null = "Sin asignar"', async () => {
    const t = setup();
    const member = makeMember({ currentPlanId: t.plan.id });
    t.db.members.push(member);
    const assigned = await t.updateMember.execute(ctxOf(t.admin), member.id, { soldByStaffId: t.staff.aileen.id });
    expect(assigned.soldBy).toEqual({ id: t.staff.aileen.id, displayName: 'Aileen' });
    const audit = t.db.audit.at(-1)!;
    expect(audit).toMatchObject({ entity: 'MEMBER', action: 'UPDATE' });
    expect(audit.changedFields).toEqual(['soldByName', 'soldByStaffId']);
    expect(audit.before).toMatchObject({ soldByStaffId: null, soldByName: null });
    expect(audit.after).toMatchObject({ soldByStaffId: t.staff.aileen.id, soldByName: 'Aileen' });
    const detail = await t.detail.execute(member.id);
    expect(detail.soldBy?.displayName).toBe('Aileen');
    const cleared = await t.updateMember.execute(ctxOf(t.admin), member.id, { soldByStaffId: null });
    expect(cleared.soldBy).toBeNull();
    await t.update.execute(ctxOf(t.admin), t.staff.giovanni.id, { isActive: false });
    await expect(t.updateMember.execute(ctxOf(t.admin), member.id, { soldByStaffId: t.staff.giovanni.id })).rejects.toMatchObject({
      code: 'STAFF_INACTIVE',
    });
  });
});
