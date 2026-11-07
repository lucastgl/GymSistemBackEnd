import { Errors } from './errors';

/**
 * Monto en ARS con 2 decimales (numeric(12,2)). Internamente en centavos enteros para
 * que las sumas y comparaciones (Σ splits = total) sean exactas.
 */
export class Money {
  private constructor(readonly cents: number) {}

  static readonly ZERO = new Money(0);

  static fromNumber(value: number, field = 'amount'): Money {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw Errors.field(field, 'El monto debe ser un número', value);
    }
    const cents = Math.round(value * 100);
    if (Math.abs(cents - value * 100) > 1e-6 * Math.max(1, Math.abs(value))) {
      throw Errors.field(field, 'El monto admite como máximo 2 decimales', value);
    }
    return new Money(cents);
  }

  static fromCents(cents: number): Money {
    return new Money(Math.round(cents));
  }

  /** Para valores leídos de la base (Decimal → string/number), redondea a centavos. */
  static fromDb(value: number | string): Money {
    return new Money(Math.round(Number(value) * 100));
  }

  static sum(values: readonly Money[]): Money {
    return new Money(values.reduce((acc, m) => acc + m.cents, 0));
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  isPositive(): boolean {
    return this.cents > 0;
  }

  toNumber(): number {
    return this.cents / 100;
  }

  toString(): string {
    return (this.cents / 100).toFixed(2);
  }
}

/** Redondeo a 2 decimales para montos calculados (métricas). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Redondeo a 1 decimal (porcentajes y permanencia). */
export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
