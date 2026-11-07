import { DateOnly } from '../shared/date-only';
import { MemberStatus, MemberStatusEventType } from '../shared/enums';

export interface StatusEventLike {
  type: MemberStatusEventType;
  effectiveOn: DateOnly;
  /** Orden de inserción para desempatar eventos del mismo día. */
  seq: number;
}

export function isCancellationEvent(type: MemberStatusEventType): boolean {
  return type === 'CANCELLED' || type === 'AUTO_CANCELLED';
}

/**
 * `status_at(d)` (03 §1): estado según el último evento con `effective_on ≤ d`;
 * sin eventos el socio está ACTIVE.
 */
export function statusAt(events: readonly StatusEventLike[], date: DateOnly): MemberStatus {
  let last: StatusEventLike | null = null;
  for (const e of events) {
    if (e.effectiveOn > date) continue;
    if (
      last === null ||
      e.effectiveOn > last.effectiveOn ||
      (e.effectiveOn === last.effectiveOn && e.seq > last.seq)
    ) {
      last = e;
    }
  }
  if (last === null) return 'ACTIVE';
  return isCancellationEvent(last.type) ? 'CANCELLED' : 'ACTIVE';
}

/**
 * Fecha efectiva de una reactivación por renovación: el día del pago, pero nunca antes de la
 * última baja (si la renovación es retroactiva) para que la historia de eventos siga siendo coherente.
 */
export function reactivationDate(paidOn: DateOnly, lastCancellationOn: DateOnly | null): DateOnly {
  return lastCancellationOn !== null && lastCancellationOn > paidOn ? lastCancellationOn : paidOn;
}
