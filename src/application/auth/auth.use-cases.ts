import { assertPasswordPolicy, normalizeEmail } from '../../domain/auth/password-policy';
import { AttemptLimiter, Clock, PasswordHasher, SecretGenerator, TokenService } from '../../domain/ports/ports';
import { TransactionContext, UnitOfWork } from '../../domain/ports/unit-of-work';
import { UserRecord } from '../../domain/repositories/records';
import { Repositories } from '../../domain/repositories/repositories';
import { Role } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { RequestContext, RequestMeta } from '../../domain/shared/request-context';
import { userLabel } from '../common/audit-snapshots';
import { loadSettings, requireUserId } from '../common/helpers';
import { UserView, userView } from '../common/views';

export interface AuthTokensView {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginView extends AuthTokensView {
  user: UserView;
}

/** Usuario de la sesión, resuelto en cada request por el guard JWT. */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

const INVALID_CREDENTIALS_MESSAGE = 'Credenciales inválidas';

/** Emite access JWT + refresh opaco (guardado como sha256) dentro de la transacción. */
export class SessionIssuer {
  constructor(
    private readonly tokens: TokenService,
    private readonly secrets: SecretGenerator,
    private readonly clock: Clock,
  ) {}

  async issue(
    tx: Pick<TransactionContext, 'refreshTokens'>,
    user: UserRecord,
    meta: RequestMeta,
    familyId?: string,
  ): Promise<AuthTokensView> {
    const refreshToken = this.tokens.generateRefreshToken();
    const expiresAt = new Date(this.clock.now().getTime() + this.tokens.refreshTokenTtlDays() * 86_400_000);
    await tx.refreshTokens.create({
      userId: user.id,
      tokenHash: this.tokens.hashRefreshToken(refreshToken),
      familyId: familyId ?? this.secrets.uuid(),
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    const access = await this.tokens.signAccessToken({
      sub: user.id,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
    return { accessToken: access.token, refreshToken, expiresIn: access.expiresIn };
  }
}

/** HU-AUTH-01. */
export class LoginUseCase {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly limiter: AttemptLimiter,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  static key(email: string): string {
    return `login:${email}`;
  }

  async execute(input: { email: string; password: string }, meta: RequestMeta): Promise<LoginView> {
    const settings = await loadSettings(this.repos);
    const email = normalizeEmail(input.email);
    const key = LoginUseCase.key(email);
    const windowMs = settings.failedAttemptsWindowMinutes * 60_000;
    if (await this.limiter.isBlocked(key, settings.maxFailedAttempts, windowMs)) {
      throw Errors.tooManyAttempts();
    }
    const user = await this.repos.users.findByEmail(email);
    // Con email inexistente igual se verifica contra un hash para no revelar el caso por tiempo.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await this.hasher.verify(hash, input.password ?? '');
    if (!user || !user.isActive || !passwordOk) {
      await this.limiter.registerFailure(key, windowMs);
      throw Errors.unauthorized(ErrorCodes.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE);
    }
    await this.limiter.reset(key);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const updated = await tx.users.update(user.id, { lastLoginAt: now });
      const tokens = await this.sessions.issue(tx, updated, meta);
      await tx.audit.log(
        { entity: 'USER', entityId: user.id, entityLabel: userLabel(user), action: 'LOGIN', after: null },
        { actor: { userId: user.id, label: user.fullName, role: user.role }, meta },
      );
      return { ...tokens, user: userView(updated) };
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('limit-breaker-dummy-password-0');
    return this.dummyHash;
  }
}

/** HU-AUTH-03: rotación del refresh; un refresh ya usado revoca toda la familia. */
export class RefreshSessionUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly tokens: TokenService,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string, meta: RequestMeta): Promise<AuthTokensView> {
    const invalid = () => Errors.unauthorized(ErrorCodes.INVALID_REFRESH_TOKEN, 'La sesión expiró. Volvé a iniciar sesión.');
    const now = this.clock.now();
    const stored = await this.repos.refreshTokens.findByHash(this.tokens.hashRefreshToken(refreshToken ?? ''));
    if (!stored) throw invalid();
    if (stored.revokedAt !== null) {
      // Reuso de un refresh ya rotado o revocado: se corta toda la familia.
      await this.repos.refreshTokens.revokeFamily(stored.familyId, now);
      throw invalid();
    }
    if (stored.expiresAt.getTime() <= now.getTime()) throw invalid();
    const user = await this.repos.users.findById(stored.userId);
    if (!user || !user.isActive) {
      await this.repos.refreshTokens.revokeFamily(stored.familyId, now);
      throw invalid();
    }
    const outcome = await this.uow.run(async (tx) => {
      const revoked = await tx.refreshTokens.revokeIfActive(stored.id, now);
      if (!revoked) return null; // otra petición lo rotó al mismo tiempo → reuso
      return this.sessions.issue(tx, user, meta, stored.familyId);
    });
    if (outcome === null) {
      await this.repos.refreshTokens.revokeFamily(stored.familyId, now);
      throw invalid();
    }
    return outcome;
  }
}

/** POST /auth/logout: revoca el refresh actual (si es del usuario). Siempre 204. */
export class LogoutUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, refreshToken: string): Promise<void> {
    const userId = requireUserId(ctx);
    const stored = await this.repos.refreshTokens.findByHash(this.tokens.hashRefreshToken(refreshToken ?? ''));
    if (stored && stored.userId === userId) {
      await this.repos.refreshTokens.revokeIfActive(stored.id, this.clock.now());
    }
  }
}

/** HU-AUTH-02: cambio de la propia contraseña; revoca refresh anteriores y emite un par nuevo. */
export class ChangePasswordUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly limiter: AttemptLimiter,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(
    ctx: RequestContext,
    input: { currentPassword: string; newPassword: string },
  ): Promise<AuthTokensView> {
    const userId = requireUserId(ctx);
    const settings = await loadSettings(this.repos);
    const user = await this.repos.users.findById(userId);
    if (!user || !user.isActive) throw Errors.unauthorized(ErrorCodes.UNAUTHORIZED, 'Sesión inválida');
    const key = LoginUseCase.key(user.email);
    const windowMs = settings.failedAttemptsWindowMinutes * 60_000;
    if (await this.limiter.isBlocked(key, settings.maxFailedAttempts, windowMs)) throw Errors.tooManyAttempts();
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword ?? ''))) {
      await this.limiter.registerFailure(key, windowMs);
      throw Errors.unauthorized(ErrorCodes.INVALID_CURRENT_PASSWORD, 'La contraseña actual no es correcta');
    }
    assertPasswordPolicy(input.newPassword, input.currentPassword);
    await this.limiter.reset(key);
    const newHash = await this.hasher.hash(input.newPassword);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const updated = await tx.users.update(user.id, { passwordHash: newHash, mustChangePassword: false });
      await tx.refreshTokens.revokeAllForUser(user.id, now);
      const tokens = await this.sessions.issue(tx, updated, ctx.meta);
      await tx.audit.log(
        {
          entity: 'USER',
          entityId: user.id,
          entityLabel: userLabel(user),
          action: 'PASSWORD_CHANGE',
          before: { mustChangePassword: user.mustChangePassword },
          after: { mustChangePassword: false, sessionsRevoked: true },
        },
        ctx,
      );
      return tokens;
    });
  }
}

/** GET /auth/me. */
export class GetMeUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(ctx: RequestContext): Promise<UserView> {
    const user = await this.repos.users.findById(requireUserId(ctx));
    if (!user) throw Errors.unauthorized(ErrorCodes.UNAUTHORIZED, 'Sesión inválida');
    return userView(user);
  }
}

/** Valida el access token y carga el usuario vigente (rol, activo y cambio pendiente siempre frescos). */
export class ResolveSessionUserUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly tokens: TokenService,
  ) {}

  async execute(accessToken: string): Promise<SessionUser | null> {
    const claims = await this.tokens.verifyAccessToken(accessToken);
    if (!claims) return null;
    const user = await this.repos.users.findById(claims.sub);
    if (!user || !user.isActive) return null;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
