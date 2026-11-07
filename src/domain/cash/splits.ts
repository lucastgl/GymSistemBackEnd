import { PaymentMethod } from '../shared/enums';
import { ErrorDetail, Errors } from '../shared/errors';
import { Money } from '../shared/money';

export interface SplitInput {
  method: PaymentMethod;
  amount: number;
}

export interface Split {
  method: PaymentMethod;
  amount: Money;
}

export const MAX_SPLITS = 4;

/**
 * Valida los métodos de pago de un movimiento (HU-REN-01, 04 §3.4):
 * al menos uno y como máximo 4; cada monto > 0 con 2 decimales; métodos distintos entre sí;
 * si se informa `expectedTotal`, la suma debe coincidir exactamente. Devuelve splits y total.
 */
export function validateSplits(
  splits: readonly SplitInput[] | undefined,
  expectedTotal?: number,
): { splits: Split[]; total: Money } {
  const details: ErrorDetail[] = [];
  if (!splits || splits.length === 0) {
    throw Errors.field('splits', 'Indicá al menos un método de pago');
  }
  if (splits.length > MAX_SPLITS) {
    throw Errors.field('splits', `Se admiten como máximo ${MAX_SPLITS} métodos de pago`);
  }
  const seen = new Set<PaymentMethod>();
  const parsed: Split[] = [];
  splits.forEach((s, i) => {
    let amount: Money;
    try {
      amount = Money.fromNumber(s.amount, `splits[${i}].amount`);
    } catch {
      details.push({ field: `splits[${i}].amount`, message: 'Monto inválido (máximo 2 decimales)', value: s.amount });
      return;
    }
    if (!amount.isPositive()) {
      details.push({ field: `splits[${i}].amount`, message: 'Cada monto debe ser mayor a 0', value: s.amount });
    }
    if (seen.has(s.method)) {
      details.push({ field: `splits[${i}].method`, message: 'Los métodos de pago deben ser distintos entre sí', value: s.method });
    }
    seen.add(s.method);
    parsed.push({ method: s.method, amount });
  });
  if (details.length > 0) throw Errors.validation('Los métodos de pago no son válidos', details);

  const total = Money.sum(parsed.map((p) => p.amount));
  if (!total.isPositive()) throw Errors.field('splits', 'El monto total debe ser mayor a 0');
  if (expectedTotal !== undefined) {
    const expected = Money.fromNumber(expectedTotal, 'amount');
    if (!expected.equals(total)) {
      throw Errors.validation('La suma de los métodos de pago debe ser igual al monto total', [
        { field: 'splits', message: `La suma es ${total.toString()} y el total es ${expected.toString()}`, value: total.toNumber() },
      ]);
    }
  }
  return { splits: parsed, total };
}
