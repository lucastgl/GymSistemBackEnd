import { DateOnly } from '../shared/date-only';
import { Period } from '../shared/period';

export type CloseStage = 'PRELIMINARY' | 'FINAL';

export interface CloseSchedule {
  graceDays: number;
  /** `metrics.auto_close_time` (HH:mm), último día del mes. */
  autoCloseTime: string;
  /** `metrics.final_close_time` (HH:mm), día gracia + 1 del mes siguiente. */
  finalCloseTime: string;
}

/** Día del cierre definitivo: fin(M) + gracia + 1 (el 16 del mes siguiente con 15 días). */
export function finalCloseDay(period: Period, graceDays: number): DateOnly {
  return DateOnly.addDays(Period.last(period), graceDays + 1);
}

/** El cierre definitivo ya corresponde (día y hora de BA alcanzados). */
export function isFinalCloseDue(period: Period, today: DateOnly, timeHHmm: string, schedule: CloseSchedule): boolean {
  const day = finalCloseDay(period, schedule.graceDays);
  return today > day || (today === day && timeHHmm >= schedule.finalCloseTime);
}

/** El cierre preliminar ya corresponde: pasó el último día del mes a la hora configurada. */
export function isPreliminaryCloseDue(period: Period, today: DateOnly, timeHHmm: string, schedule: CloseSchedule): boolean {
  const last = Period.last(period);
  return today > last || (today === last && timeHHmm >= schedule.autoCloseTime);
}

/** Etapa que corresponde a un cierre hecho ahora. */
export function stageFor(period: Period, today: DateOnly, timeHHmm: string, schedule: CloseSchedule): CloseStage {
  return isFinalCloseDue(period, today, timeHHmm, schedule) ? 'FINAL' : 'PRELIMINARY';
}

export interface PlannedClose {
  period: Period;
  stage: CloseStage;
  /** Reemplaza un cierre preliminar vigente. */
  replaces: boolean;
}

/**
 * Cierres pendientes (03 §0 regla 5 y §6b): desde el primer mes con datos hasta el mes en curso.
 * - Mes sin cierre vigente cuyo preliminar ya correspondía → se cierra (FINAL si ya pasó la gracia).
 * - Mes con cierre PRELIMINARY cuyo definitivo ya correspondía → se cierra FINAL.
 * - Mes con cierre FINAL → congelado.
 * El mismo plan lo ejecutan los crons y la recuperación al arrancar.
 */
export function planPendingCloses(input: {
  firstPeriod: Period;
  today: DateOnly;
  timeHHmm: string;
  schedule: CloseSchedule;
  currentStages: ReadonlyMap<string, CloseStage>;
}): PlannedClose[] {
  const { firstPeriod, today, timeHHmm, schedule, currentStages } = input;
  const currentMonth = Period.ofDate(today);
  if (firstPeriod > currentMonth) return [];
  const out: PlannedClose[] = [];
  for (const period of Period.range(firstPeriod, currentMonth)) {
    if (!isPreliminaryCloseDue(period, today, timeHHmm, schedule)) continue;
    const existing = currentStages.get(period) ?? null;
    const stage = stageFor(period, today, timeHHmm, schedule);
    if (existing === 'FINAL') continue;
    if (existing === 'PRELIMINARY' && stage === 'PRELIMINARY') continue;
    out.push({ period, stage, replaces: existing !== null });
  }
  return out;
}
