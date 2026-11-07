import { normalizeEmail } from '../../domain/auth/password-policy';
import { Clock, PasswordHasher, SecretGenerator } from '../../domain/ports/ports';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { Repositories, UserPatch } from '../../domain/repositories/repositories';
import { Role } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanText } from '../../domain/shared/text';
import { userLabel, userSnapshot } from '../common/audit-snapshots';
import { pageRequest, requireUserId } from '../common/helpers';
import { PageView, UserView, userView } from '../common/views';

export interface CreatedUserView extends UserView {
  temporaryPassword: string;
}

/** GET /users. */
export class ListUsersUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(q: { page?: number; pageSize?: number; role?: Role; isActive?: boolean }): Promise<PageView<UserView>> {
    const page = pageRequest(q.page, q.pageSize);
    const res = await this.repos.users.list({ role: q.role, isActive: q.isActive }, page);
    return { items: res.items.map(userView), total: res.total, ...page };
  }
}

/** GET /users/{id}. */
export class GetUserUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(id: string): Promise<UserView> {
    const user = await this.repos.users.findById(id);
    if (!user) throw Errors.notFound('Usuario');
    return userView(user);
  }
}

/** POST /users (HU-AUTH-04): la contraseña temporal se devuelve una sola vez. */
export class CreateUserUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly secrets: SecretGenerator,
  ) {}

  async execute(ctx: RequestContext, input: { email: string; fullName: string; role: Role }): Promise<CreatedUserView> {
    requireUserId(ctx);
    const email = normalizeEmail(input.email);
    const fullName = cleanText(input.fullName);
    if (!fullName || fullName.length < 2) throw Errors.field('fullName', 'Indicá el nombre completo');
    if (await this.repos.users.findByEmail(email)) {
      throw Errors.conflict(ErrorCodes.EMAIL_EXISTS, 'Ya existe un usuario con ese email');
    }
    const temporaryPassword = this.secrets.temporaryPassword();
    const passwordHash = await this.hasher.hash(temporaryPassword);
    const created = await this.uow.run(async (tx) => {
      const user = await tx.users.create({ email, passwordHash, fullName, role: input.role, mustChangePassword: true });
      await tx.audit.log(
        { entity: 'USER', entityId: user.id, entityLabel: userLabel(user), action: 'CREATE', after: userSnapshot(user) },
        ctx,
      );
      return user;
    });
    return { ...userView(created), temporaryPassword };
  }
}

/** PATCH /users/{id}: nombre, rol, activo. Protege al último ADMIN y a uno mismo. */
export class UpdateUserUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    ctx: RequestContext,
    id: string,
    input: { fullName?: string; role?: Role; isActive?: boolean },
  ): Promise<UserView> {
    const actorId = requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const user = await tx.users.findById(id);
      if (!user) throw Errors.notFound('Usuario');
      const patch: UserPatch = {};
      if (input.fullName !== undefined) {
        const name = cleanText(input.fullName);
        if (!name || name.length < 2) throw Errors.field('fullName', 'Indicá el nombre completo');
        patch.fullName = name;
      }
      if (input.role !== undefined && input.role !== user.role) patch.role = input.role;
      if (input.isActive !== undefined && input.isActive !== user.isActive) patch.isActive = input.isActive;

      const losesAdmin = user.role === 'ADMIN' && user.isActive && (patch.role !== undefined || patch.isActive === false);
      if (id === actorId && (patch.isActive === false || patch.role !== undefined)) {
        throw Errors.conflict(ErrorCodes.SELF_MODIFICATION, 'No podés desactivarte ni cambiar tu propio rol');
      }
      if (losesAdmin && (await tx.users.countActiveAdmins()) <= 1) {
        throw Errors.conflict(ErrorCodes.LAST_ADMIN, 'No se puede desactivar ni degradar al último ADMIN activo');
      }
      if (Object.keys(patch).length === 0) return userView(user);

      const updated = await tx.users.update(id, patch);
      if (patch.isActive === false) await tx.refreshTokens.revokeAllForUser(id, this.clock.now());
      await tx.audit.log(
        {
          entity: 'USER',
          entityId: id,
          entityLabel: userLabel(updated),
          action: 'UPDATE',
          before: userSnapshot(user),
          after: userSnapshot(updated),
        },
        ctx,
      );
      return userView(updated);
    });
  }
}

/** POST /users/{id}/reset-password: nueva temporal, mustChangePassword = true y sesiones revocadas. */
export class ResetUserPasswordUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly secrets: SecretGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<{ temporaryPassword: string }> {
    requireUserId(ctx);
    const temporaryPassword = this.secrets.temporaryPassword();
    const passwordHash = await this.hasher.hash(temporaryPassword);
    await this.uow.run(async (tx) => {
      const user = await tx.users.findById(id);
      if (!user) throw Errors.notFound('Usuario');
      const updated = await tx.users.update(id, { passwordHash, mustChangePassword: true });
      await tx.refreshTokens.revokeAllForUser(id, this.clock.now());
      await tx.audit.log(
        {
          entity: 'USER',
          entityId: id,
          entityLabel: userLabel(user),
          action: 'PASSWORD_CHANGE',
          before: { mustChangePassword: user.mustChangePassword },
          after: { mustChangePassword: updated.mustChangePassword, resetByAdmin: true, sessionsRevoked: true },
        },
        ctx,
      );
    });
    return { temporaryPassword };
  }
}
