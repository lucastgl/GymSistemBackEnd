import { cleanText } from './text';

/**
 * Teléfono tal como se ingresó + su forma E.164 cuando se puede normalizar (04 §6):
 * solo dígitos; quitar 0 inicial; 549 + 10 dígitos → +549…; 54 + 10 dígitos → +549…;
 * 10 dígitos → +549 + dígitos; 8 dígitos → +54911 + dígitos; otro largo → null y
 * `needsReview = true`. Un teléfono vacío no se marca para revisar.
 */
export class PhoneNumber {
  private constructor(
    readonly raw: string | null,
    readonly e164: string | null,
    readonly needsReview: boolean,
  ) {}

  static parse(value: string | null | undefined): PhoneNumber {
    const raw = cleanText(value);
    if (raw === null) return new PhoneNumber(null, null, false);
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
    let e164: string | null = null;
    if (digits.length === 13 && digits.startsWith('549')) e164 = `+${digits}`;
    else if (digits.length === 12 && digits.startsWith('54')) e164 = `+549${digits.slice(2)}`;
    else if (digits.length === 10) e164 = `+549${digits}`;
    else if (digits.length === 8) e164 = `+54911${digits}`;
    return new PhoneNumber(raw, e164, e164 === null);
  }

  static fromStored(raw: string | null, e164: string | null, needsReview: boolean): PhoneNumber {
    return new PhoneNumber(raw, e164, needsReview);
  }

  /** Dígitos para `https://wa.me/<dígitos>`; null si no hay E.164. */
  whatsappDigits(): string | null {
    return this.e164 ? this.e164.replace(/^\+/, '') : null;
  }
}
