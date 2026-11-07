/**
 * Errores de dominio con código estable (docs/05 · ErrorResponse.code).
 * La capa de presentación traduce `kind` a un código HTTP; el front traduce `code`.
 */
export type DomainErrorKind =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS';

export interface ErrorDetail {
  field?: string;
  message: string;
  value?: unknown;
}

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  INVALID_CURRENT_PASSWORD: 'INVALID_CURRENT_PASSWORD',
  FORBIDDEN: 'FORBIDDEN',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  PASSWORD_CONFIRMATION_INVALID: 'PASSWORD_CONFIRMATION_INVALID',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  LAST_ADMIN: 'LAST_ADMIN',
  SELF_MODIFICATION: 'SELF_MODIFICATION',
  PLAN_CODE_EXISTS: 'PLAN_CODE_EXISTS',
  PLAN_NAME_EXISTS: 'PLAN_NAME_EXISTS',
  PLAN_INACTIVE: 'PLAN_INACTIVE',
  MEMBER_NAME_EXISTS: 'MEMBER_NAME_EXISTS',
  MEMBER_HAS_ACTIVITY: 'MEMBER_HAS_ACTIVITY',
  MEMBER_ALREADY_CANCELLED: 'MEMBER_ALREADY_CANCELLED',
  MEMBER_ALREADY_ACTIVE: 'MEMBER_ALREADY_ACTIVE',
  MEMBER_PHONE_INVALID: 'MEMBER_PHONE_INVALID',
  MEMBER_CANCELLED: 'MEMBER_CANCELLED',
  DUPLICATE_CHECKIN: 'DUPLICATE_CHECKIN',
  RECORD_VOIDED: 'RECORD_VOIDED',
  CATEGORY_NOT_ALLOWED: 'CATEGORY_NOT_ALLOWED',
  CATEGORY_EXISTS: 'CATEGORY_EXISTS',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  SYSTEM_CATEGORY: 'SYSTEM_CATEGORY',
  EDIT_VIA_MEMBERSHIP: 'EDIT_VIA_MEMBERSHIP',
  VOID_VIA_MEMBERSHIP: 'VOID_VIA_MEMBERSHIP',
  PERIOD_ALREADY_CLOSED: 'PERIOD_ALREADY_CLOSED',
  PERIOD_IN_FUTURE: 'PERIOD_IN_FUTURE',
  LEGACY_PERIOD_FROZEN: 'LEGACY_PERIOD_FROZEN',
  CLOSE_IN_PROGRESS: 'CLOSE_IN_PROGRESS',
  UNKNOWN_SETTING: 'UNKNOWN_SETTING',
  STAFF_NAME_EXISTS: 'STAFF_NAME_EXISTS',
  STAFF_USER_LINKED: 'STAFF_USER_LINKED',
  STAFF_INACTIVE: 'STAFF_INACTIVE',
  INCENTIVE_ALREADY_PUBLISHED: 'INCENTIVE_ALREADY_PUBLISHED',
  INCENTIVE_PERIOD_CLOSED: 'INCENTIVE_PERIOD_CLOSED',
  INCENTIVE_PERIOD_NOT_EDITABLE: 'INCENTIVE_PERIOD_NOT_EDITABLE',
  INCENTIVE_RESULT_NEGATIVE: 'INCENTIVE_RESULT_NEGATIVE',
  INCENTIVE_NOT_PUBLISHED: 'INCENTIVE_NOT_PUBLISHED',
  INCENTIVE_GRACE_PENDING: 'INCENTIVE_GRACE_PENDING',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const Errors = {
  validation(message: string, details: ErrorDetail[] = []): DomainError {
    return new DomainError('VALIDATION', ErrorCodes.VALIDATION_ERROR, message, details);
  },
  field(field: string, message: string, value?: unknown): DomainError {
    return new DomainError('VALIDATION', ErrorCodes.VALIDATION_ERROR, message, [
      { field, message, ...(value === undefined ? {} : { value }) },
    ]);
  },
  /** 400 con un código propio (p. ej. STAFF_INACTIVE) sobre un campo. */
  fieldCode(code: string, field: string, message: string, value?: unknown): DomainError {
    return new DomainError('VALIDATION', code, message, [{ field, message, ...(value === undefined ? {} : { value }) }]);
  },
  notFound(entityLabel: string): DomainError {
    return new DomainError('NOT_FOUND', ErrorCodes.NOT_FOUND, `${entityLabel} no encontrado`);
  },
  conflict(code: string, message: string, details: ErrorDetail[] = []): DomainError {
    return new DomainError('CONFLICT', code, message, details);
  },
  unauthorized(code: string, message: string): DomainError {
    return new DomainError('UNAUTHORIZED', code, message);
  },
  forbidden(code: string, message: string): DomainError {
    return new DomainError('FORBIDDEN', code, message);
  },
  tooManyAttempts(
    message = 'Demasiados intentos fallidos. Esperá unos minutos y volvé a intentar.',
  ): DomainError {
    return new DomainError('TOO_MANY_REQUESTS', ErrorCodes.TOO_MANY_ATTEMPTS, message);
  },
};
