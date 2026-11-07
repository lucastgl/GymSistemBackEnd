import { Prisma, PrismaClient } from '@prisma/client';
import { AuditMeta, MemberRef, UserRef } from '../../domain/repositories/records';
import { DateOnly } from '../../domain/shared/date-only';
import { fullName } from '../../domain/shared/text';

/** Cliente base o transaccional: los repositorios funcionan con ambos. */
export type Db = PrismaClient | Prisma.TransactionClient;

export const toDateOnly = (d: Date): DateOnly => DateOnly.fromUtcDate(d);
export const toDateOnlyOrNull = (d: Date | null | undefined): DateOnly | null => (d ? DateOnly.fromUtcDate(d) : null);
export const fromDateOnly = (d: DateOnly): Date => DateOnly.toUtcDate(d);
export const fromDateOnlyOrNull = (d: DateOnly | null): Date | null => (d === null ? null : DateOnly.toUtcDate(d));

export function num(value: Prisma.Decimal | number | string | bigint): number {
  return Number(value.toString());
}

export function numOrNull(value: Prisma.Decimal | number | string | bigint | null): number | null {
  return value === null ? null : Number(value.toString());
}

/** `HH:mm` de una columna `time` (Prisma la devuelve como 1970-01-01THH:mm:ssZ). */
export function timeToString(d: Date | null): string | null {
  if (!d) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function stringToTime(value: string | null): Date | null {
  return value ? new Date(`1970-01-01T${value}:00.000Z`) : null;
}

/** JSON para columnas `Json?`: null de SQL en lugar de JSON null. */
export function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** Resuelve nombres de usuarios en lote (las columnas created_by/updated_by no tienen relación en Prisma). */
export async function userRefs(db: Db, ids: (string | null | undefined)[]): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, { id: u.id, fullName: u.fullName }]));
}

export function refOf(map: Map<string, UserRef>, id: string | null | undefined): UserRef | null {
  return id ? (map.get(id) ?? null) : null;
}

export function auditMeta(
  map: Map<string, UserRef>,
  row: { createdAt: Date; updatedAt: Date; createdById: string | null; updatedById: string | null },
): AuditMeta {
  return {
    createdAt: row.createdAt,
    createdBy: refOf(map, row.createdById),
    updatedAt: row.updatedAt,
    updatedBy: refOf(map, row.updatedById),
  };
}

export function memberRef(m: { id: string; legacyCode: string; firstName: string; lastName: string }): MemberRef {
  return { id: m.id, legacyCode: m.legacyCode, fullName: fullName(m.firstName, m.lastName) };
}

/** Patrón LIKE `%texto%` con comodines escapados (backslash es el escape por defecto en Postgres). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Reordena registros según la lista de ids devuelta por una consulta SQL ordenada. */
export function orderByIds<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
}

export const memberSelect = { id: true, legacyCode: true, firstName: true, lastName: true } as const;
