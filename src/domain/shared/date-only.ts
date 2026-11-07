import { Errors } from './errors';

declare const dateOnlyBrand: unique symbol;

/**
 * Fecha calendario de negocio `YYYY-MM-DD` (zona America/Argentina/Buenos_Aires).
 * Es un string con marca de tipo: se serializa tal cual en JSON y se compara
 * lexicográficamente. La aritmética se hace sobre UTC para no depender de la zona del host.
 */
export type DateOnly = string & { readonly [dateOnlyBrand]: 'DateOnly' };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtcMs(d: string): number {
  const m = DATE_RE.exec(d);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): DateOnly {
  return new Date(ms).toISOString().slice(0, 10) as DateOnly;
}

export const DateOnly = {
  isValid(value: unknown): value is DateOnly {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
    const ms = toUtcMs(value);
    return Number.isFinite(ms) && fromUtcMs(ms) === value;
  },

  /** Valida y devuelve la fecha; lanza VALIDATION_ERROR si no es una fecha real. */
  parse(value: string, field = 'fecha'): DateOnly {
    if (!DateOnly.isValid(value)) {
      throw Errors.field(field, `Fecha inválida (se espera AAAA-MM-DD): ${String(value)}`, value);
    }
    return value;
  },

  of(year: number, month: number, day: number): DateOnly {
    return fromUtcMs(Date.UTC(year, month - 1, day));
  },

  /** Fecha calendario de un `Date` que representa medianoche UTC (columnas `date` de Prisma). */
  fromUtcDate(date: Date): DateOnly {
    return fromUtcMs(date.getTime());
  },

  /** `Date` a medianoche UTC, que es como Prisma escribe columnas `@db.Date`. */
  toUtcDate(date: DateOnly): Date {
    return new Date(toUtcMs(date));
  },

  addDays(date: DateOnly, days: number): DateOnly {
    return fromUtcMs(toUtcMs(date) + days * DAY_MS);
  },

  /** Días calendario `to − from` (entero, puede ser negativo). */
  diffDays(from: DateOnly, to: DateOnly): number {
    return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
  },

  compare(a: DateOnly, b: DateOnly): number {
    return a < b ? -1 : a > b ? 1 : 0;
  },

  max(a: DateOnly, b: DateOnly): DateOnly {
    return a >= b ? a : b;
  },

  min(a: DateOnly, b: DateOnly): DateOnly {
    return a <= b ? a : b;
  },

  year(date: DateOnly): number {
    return Number(date.slice(0, 4));
  },

  month(date: DateOnly): number {
    return Number(date.slice(5, 7));
  },

  day(date: DateOnly): number {
    return Number(date.slice(8, 10));
  },
};
