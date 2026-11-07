import { PaymentMethod } from './enums';

/** trim + colapso de espacios internos; `null` si queda vacío. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/** Igual que cleanText pero conserva saltos de línea (notas). */
export function cleanMultiline(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
  return s === '' ? null : s;
}

/** Texto comparable: NFD sin diacríticos, minúsculas, espacios colapsados (04 §6). */
export function foldText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `search_name` = (nombre + ' ' + apellido) sin acentos, en minúsculas y con espacios colapsados.
 * Es la misma regla que usa la importación de sql/tools (04 §6).
 */
export function searchName(firstName: string, lastName: string): string {
  return foldText(`${firstName} ${lastName}`);
}

/** Normaliza el texto buscado igual que `search_name` (búsqueda sin acentos ni mayúsculas). */
export function normalizeSearchQuery(q: string | null | undefined): string | null {
  const folded = foldText(q);
  return folded === '' ? null : folded;
}

/** Escapa comodines de LIKE (`%`, `_`, `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  mp: 'MERCADOPAGO',
  mercadopago: 'MERCADOPAGO',
  'mercado pago': 'MERCADOPAGO',
  'mercado-pago': 'MERCADOPAGO',
  efectivo: 'CASH',
  transferencia: 'TRANSFER',
  debito: 'DEBIT',
  credito: 'CREDIT',
  otro: 'OTHER',
  otros: 'OTHER',
  cash: 'CASH',
  transfer: 'TRANSFER',
  debit: 'DEBIT',
  credit: 'CREDIT',
  other: 'OTHER',
};

/**
 * Método de pago legacy o libre → enum (replica `normalizarMetodoPago_`, 04 §6).
 * Comparación sin mayúsculas, sin acentos y con espacios colapsados. `null` si no se reconoce.
 */
export function normalizePaymentMethod(value: string | null | undefined): PaymentMethod | null {
  const key = foldText(value);
  if (!key) return null;
  return PAYMENT_METHOD_MAP[key] ?? null;
}

/** Nombre completo para mostrar: "Nombre Apellido". */
export function fullName(firstName: string, lastName?: string | null): string {
  return [firstName, lastName ?? ''].map((s) => s.trim()).filter(Boolean).join(' ');
}

/** Formatea un código legacy con prefijo y padding (3/4/4/4); se extiende si supera el ancho. */
export function formatCode(prefix: string, n: number, width: number): string {
  return `${prefix}${String(n).padStart(width, '0')}`;
}
