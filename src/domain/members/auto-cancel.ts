import { DateOnly } from '../shared/date-only';
import { MemberStatus } from '../shared/enums';

export interface AutoCancelCandidate {
  id: string;
  status: MemberStatus;
  expiresAt: DateOnly | null;
  deletedAt: Date | null;
}

/**
 * Regla de baja automática (`aplicarBajasAutomaticas_`, HU-SOC-05): un socio ACTIVE no anulado
 * pasa a baja cuando su vencimiento tiene MÁS de `thresholdDays` días (`members.auto_cancel_after_days`).
 * Es decir, el día `vencimiento + thresholdDays + 1` (03 §6b). Sin vencimiento no se decide.
 */
export function shouldAutoCancel(member: AutoCancelCandidate, today: DateOnly, thresholdDays: number): boolean {
  if (member.status !== 'ACTIVE' || member.deletedAt !== null || member.expiresAt === null) return false;
  return DateOnly.diffDays(member.expiresAt, today) > thresholdDays;
}

/** Último vencimiento que todavía NO dispara la baja: los vencidos antes de esta fecha se dan de baja. */
export function autoCancelCutoff(today: DateOnly, thresholdDays: number): DateOnly {
  return DateOnly.addDays(today, -thresholdDays);
}

export function selectAutoCancellations<T extends AutoCancelCandidate>(
  members: readonly T[],
  today: DateOnly,
  thresholdDays: number,
): T[] {
  return members.filter((m) => shouldAutoCancel(m, today, thresholdDays));
}
