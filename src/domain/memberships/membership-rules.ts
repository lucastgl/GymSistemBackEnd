import { DateOnly } from '../shared/date-only';
import { RecordStatus } from '../shared/enums';
import { Errors } from '../shared/errors';

export interface MembershipLike {
  id: string;
  status: RecordStatus;
  planId: string | null;
  startsOn: DateOnly;
  expiresOn: DateOnly;
  createdAt: Date;
}

/** Fecha de pago no futura y vencimiento ≥ fecha de pago (HU-REN-01, 04 §4 regla 2). */
export function validateMembershipDates(paidOn: DateOnly, expiresOn: DateOnly, today: DateOnly): void {
  if (paidOn > today) throw Errors.field('paidOn', 'La fecha de pago no puede ser futura', paidOn);
  if (expiresOn < paidOn) {
    throw Errors.field('expiresOn', 'El vencimiento no puede ser anterior a la fecha de pago', expiresOn);
  }
}

/** Vencimiento sugerido: fecha de pago + `memberships.default_duration_days` (o la duración del plan). */
export function suggestedExpiry(paidOn: DateOnly, durationDays: number): DateOnly {
  return DateOnly.addDays(paidOn, durationDays);
}

/**
 * Membresía vigente del socio (04 §4 regla 4): la ACTIVE más reciente por `starts_on`
 * y, a igualdad, por `created_at`.
 */
export function pickCurrentMembership<T extends MembershipLike>(memberships: readonly T[]): T | null {
  let best: T | null = null;
  for (const m of memberships) {
    if (m.status !== 'ACTIVE') continue;
    if (
      best === null ||
      m.startsOn > best.startsOn ||
      (m.startsOn === best.startsOn && m.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = m;
    }
  }
  return best;
}

export interface MemberRenewalFields {
  lastRenewalAt: DateOnly | null;
  expiresAt: DateOnly | null;
  /** `undefined` = no tocar el plan actual del socio. */
  currentPlanId: string | null | undefined;
}

/**
 * Campos desnormalizados del socio derivados de sus membresías (04 §4 regla 4).
 * Si no queda ninguna membresía activa, vencimiento y última renovación quedan en null y el
 * plan actual del socio se conserva (ver docs/fase2-observaciones-backend.md).
 */
export function deriveMemberRenewalFields(memberships: readonly MembershipLike[]): MemberRenewalFields {
  const current = pickCurrentMembership(memberships);
  if (current === null) return { lastRenewalAt: null, expiresAt: null, currentPlanId: undefined };
  return {
    lastRenewalAt: current.startsOn,
    expiresAt: current.expiresOn,
    currentPlanId: current.planId ?? undefined,
  };
}

/** Descripción del movimiento de caja de una renovación (04 §5): "Renovación <plan> – <socio>". */
export function renewalMovementDescription(planName: string, memberFullName: string): string {
  return `Renovación ${planName} – ${memberFullName}`;
}

export const RENEWAL_CATEGORY_NAME = 'Renovación';
