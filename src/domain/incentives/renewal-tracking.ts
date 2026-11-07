import {
  buildCoverages,
  Coverage,
  isRenewedWithinGrace,
  MetricsMember,
  MetricsMembership,
} from '../metrics/metrics-calculator';
import { DateOnly } from '../shared/date-only';
import { Period } from '../shared/period';

/**
 * Renovaciones del equipo (docs/03 §8.1): misma lógica V1 que `expirations_not_renewed`.
 * De las coberturas que vencen en el mes (incluidas las sintéticas de §6b), renovada = hay una
 * membresía posterior del socio que empieza a más tardar en `expires_on + gracia`.
 */

/** RENEWED: renovó · PENDING: todavía puede renovar (dentro de la gracia) · LOST: gracia vencida sin renovar. */
export type ExpirationState = 'RENEWED' | 'PENDING' | 'LOST';

export interface TrackedExpiration extends Coverage {
  graceEndsOn: DateOnly;
  state: ExpirationState;
}

export interface PeriodRenewals {
  period: Period;
  /** Hay pagos registrados antes del mes. Sin ellos los vencimientos no se conocen (abril 2026, M5). */
  hasData: boolean;
  expirations: number;
  renewed: number;
  pending: number;
  lost: number;
  /** renovados / vencimientos × 100 (2 decimales); null sin vencimientos o sin datos. */
  ratePct: number | null;
  lastExpiresOn: DateOnly | null;
  /** Último vencimiento del mes + gracia (o fin de mes + gracia si no hay vencimientos). */
  graceEndsOn: DateOnly;
  /** La cifra ya no cambia: terminó el mes y venció la gracia del último vencimiento. */
  isFinal: boolean;
  items: TrackedExpiration[];
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Seguimiento de vencimientos sobre los datos de `MetricsRepository.loadDataset` del último mes
 * que interesa (incluye las membresías que empiezan hasta fin de ese mes + gracia, que alcanzan
 * para evaluar cualquier mes anterior).
 */
export class RenewalTracker {
  private readonly coverages: Coverage[];
  private readonly byMember = new Map<string, MetricsMembership[]>();
  private readonly firstStart: DateOnly | null;

  constructor(
    members: readonly MetricsMember[],
    memberships: readonly MetricsMembership[],
    private readonly graceDays: number,
  ) {
    this.coverages = buildCoverages(members, memberships);
    let first: DateOnly | null = null;
    for (const m of memberships) {
      const list = this.byMember.get(m.memberId) ?? [];
      list.push(m);
      this.byMember.set(m.memberId, list);
      if (first === null || m.startsOn < first) first = m.startsOn;
    }
    this.firstStart = first;
  }

  forPeriod(period: Period, today: DateOnly): PeriodRenewals {
    const ini = Period.first(period);
    const fin = Period.last(period);
    const hasData = this.firstStart !== null && this.firstStart < ini;
    const items: TrackedExpiration[] = [];
    let lastExpiresOn: DateOnly | null = null;
    for (const c of this.coverages) {
      if (c.expiresOn < ini || c.expiresOn > fin) continue;
      const graceEndsOn = DateOnly.addDays(c.expiresOn, this.graceDays);
      const state: ExpirationState = isRenewedWithinGrace(c, this.byMember.get(c.memberId) ?? [], this.graceDays)
        ? 'RENEWED'
        : today <= graceEndsOn
          ? 'PENDING'
          : 'LOST';
      items.push({ ...c, graceEndsOn, state });
      if (lastExpiresOn === null || c.expiresOn > lastExpiresOn) lastExpiresOn = c.expiresOn;
    }
    items.sort((a, b) => (a.expiresOn === b.expiresOn ? a.memberId.localeCompare(b.memberId) : a.expiresOn < b.expiresOn ? -1 : 1));
    const count = (s: ExpirationState): number => items.filter((i) => i.state === s).length;
    const renewed = count('RENEWED');
    const graceEndsOn = DateOnly.addDays(lastExpiresOn ?? fin, this.graceDays);
    return {
      period,
      hasData,
      expirations: items.length,
      renewed,
      pending: count('PENDING'),
      lost: count('LOST'),
      ratePct: hasData && items.length > 0 ? round2((renewed * 100) / items.length) : null,
      lastExpiresOn,
      graceEndsOn,
      isFinal: today > fin && today > graceEndsOn,
      items,
    };
  }
}

/**
 * Desde qué día se puede cerrar (liquidar) el mes (docs/03 §8.3): el día siguiente al fin de la
 * gracia del último vencimiento (en la práctica el 16 del mes siguiente), nunca antes de que
 * termine el mes (las altas cuentan hasta el último día).
 */
export function closableFrom(period: Period, renewals: Pick<PeriodRenewals, 'graceEndsOn'>): DateOnly {
  return DateOnly.max(Period.first(Period.next(period)), DateOnly.addDays(renewals.graceEndsOn, 1));
}
