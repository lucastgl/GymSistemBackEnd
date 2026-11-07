import { ErrorDetail, Errors } from '../shared/errors';

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Política de contraseña (HU-AUTH-02): mínimo 10 caracteres, al menos una letra y un número,
 * distinta de la actual. Devuelve la lista de incumplimientos (vacía si es válida).
 */
export function passwordPolicyViolations(newPassword: string, currentPassword?: string): string[] {
  const issues: string[] = [];
  if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
    issues.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (!/\p{L}/u.test(newPassword ?? '')) issues.push('Debe incluir al menos una letra');
  if (!/\p{Nd}/u.test(newPassword ?? '')) issues.push('Debe incluir al menos un número');
  if (currentPassword !== undefined && newPassword === currentPassword) {
    issues.push('Debe ser distinta de la contraseña actual');
  }
  return issues;
}

export function assertPasswordPolicy(newPassword: string, currentPassword?: string): void {
  const issues = passwordPolicyViolations(newPassword, currentPassword);
  if (issues.length > 0) {
    const details: ErrorDetail[] = issues.map((message) => ({ field: 'newPassword', message }));
    throw Errors.validation('La nueva contraseña no cumple la política', details);
  }
}

/** Email de login: siempre en minúsculas y sin espacios (04 §3.1). */
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}
