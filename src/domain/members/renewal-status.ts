import { DateOnly } from '../shared/date-only';
import { MemberStatus, RenewalStatus } from '../shared/enums';

/** Umbrales `renewal.warn_days` ([3, 7]). */
export interface RenewalWarnDays {
  due3d: number;
  due7d: number;
}

export const DEFAULT_WARN_DAYS: RenewalWarnDays = { due3d: 3, due7d: 7 };

/** `d = expires_at − hoy` en días calendario; null si no hay vencimiento. */
export function daysToExpire(expiresAt: DateOnly | null, today: DateOnly): number | null {
  return expiresAt === null ? null : DateOnly.diffDays(today, expiresAt);
}

/**
 * Estado de cuota (03 §5, replica `classifyStatus`):
 * CANCELLED si el socio está de baja; UNKNOWN sin vencimiento; EXPIRED d<0; DUE_TODAY d=0;
 * DUE_3D 1≤d≤3; DUE_7D 4≤d≤7; OK d>7. Solo usa fechas calendario (corrige P12).
 */
export function renewalStatus(
  member: { status: MemberStatus; expiresAt: DateOnly | null },
  today: DateOnly,
  warn: RenewalWarnDays = DEFAULT_WARN_DAYS,
): RenewalStatus {
  if (member.status === 'CANCELLED') return 'CANCELLED';
  const d = daysToExpire(member.expiresAt, today);
  if (d === null) return 'UNKNOWN';
  if (d < 0) return 'EXPIRED';
  if (d === 0) return 'DUE_TODAY';
  if (d <= warn.due3d) return 'DUE_3D';
  if (d <= warn.due7d) return 'DUE_7D';
  return 'OK';
}

/** "Cuota al día" = OK, DUE_7D, DUE_3D, DUE_TODAY. */
export function isUpToDate(status: RenewalStatus): boolean {
  return status === 'OK' || status === 'DUE_7D' || status === 'DUE_3D' || status === 'DUE_TODAY';
}

/** Orden de prioridad del padrón (docs/05 GET /members): EXPIRED → … → UNKNOWN → CANCELLED. */
export const RENEWAL_PRIORITY: readonly RenewalStatus[] = [
  'EXPIRED',
  'DUE_TODAY',
  'DUE_3D',
  'DUE_7D',
  'OK',
  'UNKNOWN',
  'CANCELLED',
];

export function renewalPriority(status: RenewalStatus): number {
  return RENEWAL_PRIORITY.indexOf(status);
}
