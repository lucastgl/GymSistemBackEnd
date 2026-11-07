import { AttemptLimiter, PasswordHasher } from '../../domain/ports/ports';
import { Repositories } from '../../domain/repositories/repositories';
import { BusinessSettings } from '../../domain/settings/business-settings';
import { ErrorCodes, Errors } from '../../domain/shared/errors';

/**
 * Confirmación de egresos con la contraseña del propio usuario (decisión D5, HU-CAJA-03/04).
 * - Sin contraseña → 400 VALIDATION_ERROR.
 * - Con `security.max_failed_attempts` fallos en la ventana → 429 (se chequea antes de verificar).
 * - Contraseña distinta → 403 PASSWORD_CONFIRMATION_INVALID (no 401: no cierra la sesión).
 * La contraseña ingresada no se guarda ni se loguea; solo se compara con el hash.
 */
export class PasswordConfirmationService {
  constructor(
    private readonly repos: Repositories,
    private readonly hasher: PasswordHasher,
    private readonly limiter: AttemptLimiter,
  ) {}

  static key(userId: string): string {
    return `confirm:${userId}`;
  }

  async confirm(userId: string, password: string | undefined | null, settings: BusinessSettings): Promise<void> {
    if (typeof password !== 'string' || password.length === 0) {
      throw Errors.field('confirmPassword', 'Ingresá tu contraseña para confirmar el egreso');
    }
    const key = PasswordConfirmationService.key(userId);
    const windowMs = settings.failedAttemptsWindowMinutes * 60_000;
    if (await this.limiter.isBlocked(key, settings.maxFailedAttempts, windowMs)) {
      throw Errors.tooManyAttempts('Demasiadas confirmaciones fallidas. Esperá unos minutos y volvé a intentar.');
    }
    const user = await this.repos.users.findById(userId);
    const ok = user !== null && user.isActive && (await this.hasher.verify(user.passwordHash, password));
    if (!ok) {
      await this.limiter.registerFailure(key, windowMs);
      throw Errors.forbidden(
        ErrorCodes.PASSWORD_CONFIRMATION_INVALID,
        'La contraseña ingresada no coincide con la tuya. El egreso no se registró.',
      );
    }
    await this.limiter.reset(key);
  }
}
