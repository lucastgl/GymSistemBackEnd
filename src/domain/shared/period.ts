import { DateOnly } from './date-only';
import { Errors } from './errors';

declare const periodBrand: unique symbol;

/** Mes calendario `YYYY-MM` (03 · notación M). */
export type Period = string & { readonly [periodBrand]: 'Period' };

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function make(year: number, month: number): Period {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}` as Period;
}

export const Period = {
  isValid(value: unknown): value is Period {
    return typeof value === 'string' && PERIOD_RE.test(value);
  },

  parse(value: string, field = 'period'): Period {
    if (!Period.isValid(value)) {
      throw Errors.field(field, `Período inválido (se espera AAAA-MM): ${String(value)}`, value);
    }
    return value;
  },

  of(year: number, month: number): Period {
    return make(year, month);
  },

  ofDate(date: DateOnly): Period {
    return date.slice(0, 7) as Period;
  },

  year(p: Period): number {
    return Number(p.slice(0, 4));
  },

  month(p: Period): number {
    return Number(p.slice(5, 7));
  },

  /** ini(M): primer día del mes. */
  first(p: Period): DateOnly {
    return DateOnly.of(Period.year(p), Period.month(p), 1);
  },

  /** fin(M): último día del mes. */
  last(p: Period): DateOnly {
    return DateOnly.addDays(Period.first(Period.next(p)), -1);
  },

  previous(p: Period): Period {
    return make(Period.year(p), Period.month(p) - 1);
  },

  next(p: Period): Period {
    return make(Period.year(p), Period.month(p) + 1);
  },

  compare(a: Period, b: Period): number {
    return a < b ? -1 : a > b ? 1 : 0;
  },

  contains(p: Period, date: DateOnly): boolean {
    return date.slice(0, 7) === p;
  },

  /** Lista ascendente de períodos entre `from` y `to` inclusive. */
  range(from: Period, to: Period): Period[] {
    const out: Period[] = [];
    for (let p = from; p <= to; p = Period.next(p)) out.push(p);
    return out;
  },
};
