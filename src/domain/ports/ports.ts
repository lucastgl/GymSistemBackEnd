import { DateOnly } from '../shared/date-only';
import { Role } from '../shared/enums';

/** Reloj del negocio (zona America/Argentina/Buenos_Aires). */
export interface Clock {
  now(): Date;
  /** Fecha calendario de hoy en la zona del negocio. */
  today(): DateOnly;
  /** Hora actual `HH:mm` en la zona del negocio. */
  timeOfDay(): string;
  /** Fecha calendario de un instante en la zona del negocio (`checked_in_on`). */
  businessDateOf(instant: Date): DateOnly;
  /** Instante UTC de una fecha y hora de la zona del negocio. */
  instantOf(date: DateOnly, timeHHmm: string): Date;
  timeZone(): string;
}

/** argon2id en formato PHC (04 §3.1). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface TokenService {
  signAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims | null>;
  /** Refresh token opaco aleatorio. */
  generateRefreshToken(): string;
  /** sha256 del refresh token (lo único que se guarda). */
  hashRefreshToken(token: string): string;
  refreshTokenTtlDays(): number;
}

export interface SecretGenerator {
  /** Contraseña temporal que cumple la política (letras y números, ≥ 10). */
  temporaryPassword(): string;
  uuid(): string;
  /** UUID determinístico a partir de un nombre (entity_id de parámetros en auditoría). */
  uuidFromName(name: string): string;
}

/** Límite de intentos fallidos por clave (login por email, confirmación de egresos por usuario). */
export interface AttemptLimiter {
  isBlocked(key: string, maxAttempts: number, windowMs: number): Promise<boolean>;
  registerFailure(key: string, windowMs: number): Promise<void>;
  reset(key: string): Promise<void>;
}

/** Etiquetas y plantillas de docs/06-etiquetas.json (copiado en contract/labels.json). */
export interface LabelCatalog {
  whatsappTemplate(key: string): string | null;
  label(enumName: string, value: string): string;
}
