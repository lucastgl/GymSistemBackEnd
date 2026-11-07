import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ChangePasswordUseCase,
  LoginUseCase,
  RefreshSessionUseCase,
  SessionIssuer,
} from '../../src/application/auth/auth.use-cases';
import { InMemoryAttemptLimiter } from '../../src/infrastructure/security/security-adapters';
import { ALLOW_PENDING_PASSWORD_KEY } from '../../src/presentation/http/http-context';
import { MustChangePasswordGuard } from '../../src/presentation/http/guards';
import { ctxOf, makeUser, seed } from '../support/fixtures';
import { FakeHasher, FakeSecrets, FakeTokenService, InMemoryUnitOfWork, TestClock } from '../support/in-memory';

function setup() {
  const s = seed();
  const clock = new TestClock(new Date('2026-10-26T15:00:00Z'));
  const uow = new InMemoryUnitOfWork(s.db, clock);
  const hasher = new FakeHasher();
  const tokens = new FakeTokenService();
  const limiter = new InMemoryAttemptLimiter(() => clock.now().getTime());
  const sessions = new SessionIssuer(tokens, new FakeSecrets(), clock);
  return {
    ...s,
    clock,
    uow,
    login: new LoginUseCase(uow.repos, uow, hasher, limiter, sessions, clock),
    refresh: new RefreshSessionUseCase(uow.repos, uow, tokens, sessions, clock),
    changePassword: new ChangePasswordUseCase(uow.repos, uow, hasher, limiter, sessions, clock),
  };
}

const meta = { requestId: '7f8a3b1c-2d4e-4f60-8a9b-0c1d2e3f4a5b', ip: '10.0.0.1', userAgent: 'jest' };

describe('Login (HU-AUTH-01)', () => {
  it('con credenciales válidas devuelve tokens, perfil y registra LOGIN; el refresh se guarda hasheado', async () => {
    const t = setup();
    const res = await t.login.execute({ email: '  ADMIN@limitbreaker.test ', password: 'Secreta123456' }, meta);
    expect(res.accessToken).toMatch(/^access\./);
    expect(res.expiresIn).toBe(900);
    expect(res.user).toMatchObject({ email: 'admin@limitbreaker.test', role: 'ADMIN', mustChangePassword: false });
    expect(res.user.lastLoginAt).toBe('2026-10-26T15:00:00.000Z');
    expect(t.db.refreshTokens).toHaveLength(1);
    expect(t.db.refreshTokens[0]!.tokenHash).not.toBe(res.refreshToken);
    expect(t.db.audit.map((a) => a.action)).toEqual(['LOGIN']);
  });

  it('email inexistente y contraseña incorrecta dan el mismo 401 genérico', async () => {
    const t = setup();
    const a = await t.login.execute({ email: 'nadie@x.com', password: 'x' }, meta).catch((e: unknown) => e);
    const b = await t.login.execute({ email: 'admin@limitbreaker.test', password: 'mala' }, meta).catch((e: unknown) => e);
    for (const err of [a, b]) {
      expect(err).toMatchObject({ kind: 'UNAUTHORIZED', code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' });
    }
  });

  it('un usuario inactivo no puede entrar', async () => {
    const t = setup();
    t.db.users.push(makeUser({ email: 'baja@limitbreaker.test', isActive: false }));
    await expect(t.login.execute({ email: 'baja@limitbreaker.test', password: 'Secreta123456' }, meta)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('5 fallos en 15 minutos bloquean el sexto intento (429) hasta que pasa la ventana', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      await expect(t.login.execute({ email: 'admin@limitbreaker.test', password: 'mala' }, meta)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(t.login.execute({ email: 'admin@limitbreaker.test', password: 'Secreta123456' }, meta)).rejects.toMatchObject({
      kind: 'TOO_MANY_REQUESTS',
      code: 'TOO_MANY_ATTEMPTS',
    });
    t.clock.advanceMinutes(16);
    await expect(t.login.execute({ email: 'admin@limitbreaker.test', password: 'Secreta123456' }, meta)).resolves.toHaveProperty('accessToken');
  });
});

describe('Rotación del refresh token (HU-AUTH-03)', () => {
  it('rota el token y un refresh ya usado revoca toda la familia', async () => {
    const t = setup();
    const first = await t.login.execute({ email: 'admin@limitbreaker.test', password: 'Secreta123456' }, meta);
    const second = await t.refresh.execute(first.refreshToken, meta);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(t.db.refreshTokens.filter((r) => r.revokedAt === null)).toHaveLength(1);

    // Reuso del token viejo → 401 y se revoca también el token nuevo de la misma familia.
    await expect(t.refresh.execute(first.refreshToken, meta)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(t.db.refreshTokens.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(t.refresh.execute(second.refreshToken, meta)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });

  it('un refresh vencido o inexistente responde 401', async () => {
    const t = setup();
    const first = await t.login.execute({ email: 'admin@limitbreaker.test', password: 'Secreta123456' }, meta);
    await expect(t.refresh.execute('no-existe', meta)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    t.clock.advanceMinutes(7 * 24 * 60 + 1);
    await expect(t.refresh.execute(first.refreshToken, meta)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });
});

describe('Cambio obligatorio de contraseña (HU-AUTH-02)', () => {
  it('el login informa mustChangePassword y el cambio lo apaga, revoca refresh anteriores y emite un par nuevo', async () => {
    const t = setup();
    const nuevo = makeUser({ email: 'cris@limitbreaker.test', fullName: 'Cristian', role: 'RECEPCIONISTA', mustChangePassword: true, password: 'Temporal1234x' });
    t.db.users.push(nuevo);
    const login = await t.login.execute({ email: 'cris@limitbreaker.test', password: 'Temporal1234x' }, meta);
    expect(login.user.mustChangePassword).toBe(true);

    await expect(t.changePassword.execute(ctxOf(nuevo), { currentPassword: 'Temporal1234x', newPassword: 'corta' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(t.changePassword.execute(ctxOf(nuevo), { currentPassword: 'Temporal1234x', newPassword: 'Temporal1234x' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(t.changePassword.execute(ctxOf(nuevo), { currentPassword: 'equivocada', newPassword: 'NuevaClave2026' })).rejects.toMatchObject({
      code: 'INVALID_CURRENT_PASSWORD',
    });

    const tokens = await t.changePassword.execute(ctxOf(nuevo), { currentPassword: 'Temporal1234x', newPassword: 'NuevaClave2026' });
    expect(tokens.refreshToken).toBeDefined();
    expect(t.db.users.find((u) => u.id === nuevo.id)!.mustChangePassword).toBe(false);
    await expect(t.refresh.execute(login.refreshToken, meta)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    const audit = t.db.audit.find((a) => a.action === 'PASSWORD_CHANGE')!;
    expect(JSON.stringify(audit)).not.toMatch(/NuevaClave2026|Temporal1234x|fake\$/);
  });

  it('el guard responde 403 PASSWORD_CHANGE_REQUIRED fuera de /auth/*', () => {
    const reflector = new Reflector();
    const guard = new MustChangePasswordGuard(reflector);
    const handler = () => undefined;
    class AnyController {}
    const ctx = (mustChangePassword: boolean, allow = false) => {
      if (allow) Reflect.defineMetadata(ALLOW_PENDING_PASSWORD_KEY, true, handler);
      else Reflect.deleteMetadata(ALLOW_PENDING_PASSWORD_KEY, handler);
      return {
        getHandler: () => handler,
        getClass: () => AnyController,
        switchToHttp: () => ({ getRequest: () => ({ user: { mustChangePassword } }) }),
      } as unknown as ExecutionContext;
    };
    expect(() => guard.canActivate(ctx(true))).toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(guard.canActivate(ctx(true, true))).toBe(true);
    expect(guard.canActivate(ctx(false))).toBe(true);
  });
});
