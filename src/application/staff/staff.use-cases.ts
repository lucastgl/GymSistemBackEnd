import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { StaffMemberRecord } from '../../domain/repositories/records';
import { Repositories, StaffMemberData } from '../../domain/repositories/repositories';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText } from '../../domain/shared/text';
import { staffSnapshot } from '../common/audit-snapshots';
import { requireUserId } from '../common/helpers';
import { StaffMemberView, staffMemberView, StaffOptionView } from '../common/views';

/**
 * Equipo (HU-OBJ-06): personas que cierran ventas ("Vendido por") y cobran bonos. Puede o no
 * tener usuario (Aileen no tiene). No se borran: se desactivan.
 */

export interface StaffMemberInput {
  displayName?: string;
  userId?: string | null;
  isBonusEligible?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  notes?: string | null;
}

function displayNameOrThrow(value: string | undefined | null): string {
  const name = cleanText(value);
  if (!name || name.length < 2) throw Errors.field('displayName', 'El nombre tiene que tener al menos 2 letras', value);
  if (name.length > 60) throw Errors.field('displayName', 'El nombre puede tener hasta 60 caracteres', value);
  return name;
}

async function ensureUniqueName(repos: Pick<Repositories, 'staff'>, name: string, excludeId?: string): Promise<void> {
  const existing = await repos.staff.findByDisplayName(name, excludeId);
  if (existing) {
    throw Errors.conflict(ErrorCodes.STAFF_NAME_EXISTS, `Ya hay una persona del equipo que se llama "${existing.displayName}"`, [
      { field: 'displayName', message: 'Nombre repetido', value: name },
    ]);
  }
}

async function ensureLinkableUser(repos: Pick<Repositories, 'staff' | 'users'>, userId: string, excludeId?: string): Promise<void> {
  const user = await repos.users.findById(userId);
  if (!user) throw Errors.field('userId', 'El usuario no existe', userId);
  const linked = await repos.staff.findByUserId(userId, excludeId);
  if (linked) {
    throw Errors.conflict(ErrorCodes.STAFF_USER_LINKED, `El usuario ${user.fullName} ya está vinculado a ${linked.displayName}`, [
      { field: 'userId', message: 'Usuario ya vinculado', value: userId },
    ]);
  }
}

const byOrder = (a: StaffMemberRecord, b: StaffMemberRecord): number =>
  a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, 'es');

/** GET /staff-members (ADMIN). */
export class ListStaffMembersUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(input: { includeInactive?: boolean }): Promise<StaffMemberView[]> {
    const rows = await this.repos.staff.list(input.includeInactive === true);
    return [...rows].sort(byOrder).map(staffMemberView);
  }
}

/** GET /staff-members/options (ADMIN, RECEPCIONISTA): solo activos, sin datos de bono. */
export class ListStaffOptionsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(ctx: RequestContext): Promise<StaffOptionView[]> {
    const rows = await this.repos.staff.list(false);
    return [...rows].sort(byOrder).map((s) => ({
      id: s.id,
      displayName: s.displayName,
      isCurrentUser: ctx.actor.userId !== null && s.userId === ctx.actor.userId,
    }));
  }
}

/** POST /staff-members (ADMIN). */
export class CreateStaffMemberUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(ctx: RequestContext, input: StaffMemberInput): Promise<StaffMemberView> {
    const userId = requireUserId(ctx);
    const displayName = displayNameOrThrow(input.displayName);
    return this.uow.run(async (tx) => {
      await ensureUniqueName(tx, displayName);
      const linkedUserId = input.userId ?? null;
      if (linkedUserId) await ensureLinkableUser(tx, linkedUserId);
      const created = await tx.staff.create({
        displayName,
        userId: linkedUserId,
        isBonusEligible: input.isBonusEligible ?? false,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        notes: cleanMultiline(input.notes ?? null),
        createdById: userId,
      });
      await tx.audit.log(
        { entity: 'STAFF_MEMBER', entityId: created.id, entityLabel: created.displayName, action: 'CREATE', after: staffSnapshot(created) },
        ctx,
      );
      return staffMemberView(created);
    });
  }
}

/**
 * PATCH /staff-members/{id} (ADMIN). Desactivar o sacarle el bono no cambia los meses ya
 * publicados: conservan la lista de elegibles congelada.
 */
export class UpdateStaffMemberUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(ctx: RequestContext, id: string, input: StaffMemberInput): Promise<StaffMemberView> {
    const userId = requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const current = await tx.staff.findById(id);
      if (!current) throw Errors.notFound('Persona del equipo');
      const patch: Partial<StaffMemberData> = {};
      if (input.displayName !== undefined) {
        const name = displayNameOrThrow(input.displayName);
        if (name !== current.displayName) {
          await ensureUniqueName(tx, name, id);
          patch.displayName = name;
        }
      }
      if (input.userId !== undefined && input.userId !== current.userId) {
        if (input.userId !== null) await ensureLinkableUser(tx, input.userId, id);
        patch.userId = input.userId;
      }
      if (input.isBonusEligible !== undefined && input.isBonusEligible !== current.isBonusEligible) {
        patch.isBonusEligible = input.isBonusEligible;
      }
      if (input.isActive !== undefined && input.isActive !== current.isActive) patch.isActive = input.isActive;
      if (input.sortOrder !== undefined && input.sortOrder !== current.sortOrder) patch.sortOrder = input.sortOrder;
      if (input.notes !== undefined) {
        const notes = cleanMultiline(input.notes);
        if (notes !== current.notes) patch.notes = notes;
      }
      if (Object.keys(patch).length === 0) return staffMemberView(current);
      const updated = await tx.staff.update(id, { ...patch, updatedById: userId });
      await tx.audit.log(
        {
          entity: 'STAFF_MEMBER',
          entityId: id,
          entityLabel: updated.displayName,
          action: 'UPDATE',
          before: staffSnapshot(current),
          after: staffSnapshot(updated),
        },
        ctx,
      );
      return staffMemberView(updated);
    });
  }
}
