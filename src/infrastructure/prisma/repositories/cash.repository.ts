import { Prisma } from '@prisma/client';
import { CashMovementRecord, CashMovementRowRecord, CashTotalsRecord } from '../../../domain/repositories/records';
import {
  CashFilter,
  CashMovementPatch,
  CashMovementRepository,
  NewCashMovement,
  PageRequest,
  Paged,
} from '../../../domain/repositories/repositories';
import { MovementOrigin, MovementType, PaymentMethod, RecordStatus } from '../../../domain/shared/enums';
import { foldText } from '../../../domain/shared/text';
import { auditMeta, Db, fromDateOnly, likePattern, memberRef, memberSelect, num, orderByIds, toDateOnly, userRefs } from '../support';
import { toCategory } from './catalog.repositories';

const include = {
  category: true,
  splits: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  member: { select: memberSelect },
  membership: { select: { id: true } },
} satisfies Prisma.CashMovementInclude;

type Row = Prisma.CashMovementGetPayload<{ include: typeof include }>;

async function toRecords(db: Db, rows: Row[]): Promise<CashMovementRecord[]> {
  const users = await userRefs(db, rows.flatMap((r) => [r.createdById, r.updatedById]));
  return rows.map((c) => ({
    id: c.id,
    legacyCode: c.legacyCode,
    occurredOn: toDateOnly(c.occurredOn),
    type: c.type as MovementType,
    category: toCategory(c.category),
    subcategory: c.subcategory,
    amount: num(c.amount),
    splits: c.splits.map((s) => ({ method: s.method as PaymentMethod, amount: num(s.amount) })),
    description: c.description,
    memberId: c.memberId,
    member: c.member ? memberRef(c.member) : null,
    origin: c.origin as MovementOrigin,
    membershipId: c.membership?.id ?? null,
    status: c.status as RecordStatus,
    voidedAt: c.voidedAt,
    voidReason: c.voidReason,
    audit: auditMeta(users, c),
  }));
}

/** FROM común: una fila por split (el filtro por método actúa sobre el split). */
const FROM = Prisma.sql`FROM cash_movements cm
  JOIN cash_movement_splits s ON s.cash_movement_id = cm.id
  JOIN cash_categories c ON c.id = cm.category_id
  LEFT JOIN members mb ON mb.id = cm.member_id`;

/**
 * WHERE único para la lista y los totales de caja (03 §5 "Totales de caja filtrados"):
 * la página y `totals` se calculan siempre sobre exactamente el mismo conjunto.
 */
export function cashWhere(f: CashFilter): Prisma.Sql {
  const c: Prisma.Sql[] = [
    Prisma.sql`cm.occurred_on BETWEEN ${f.from}::date AND ${f.to}::date`,
    Prisma.sql`cm.status::text = ${f.status}`,
  ];
  if (f.type) c.push(Prisma.sql`cm.type::text = ${f.type}`);
  if (f.categoryId) c.push(Prisma.sql`cm.category_id = ${f.categoryId}::uuid`);
  if (f.method) c.push(Prisma.sql`s.method::text = ${f.method}`);
  if (f.origin) c.push(Prisma.sql`cm.origin::text = ${f.origin}`);
  if (f.memberId) c.push(Prisma.sql`cm.member_id = ${f.memberId}::uuid`);
  if (f.createdBy) c.push(Prisma.sql`cm.created_by = ${f.createdBy}::uuid`);
  if (f.q) {
    const raw = likePattern(f.q.toLowerCase());
    const folded = likePattern(foldText(f.q));
    c.push(Prisma.sql`(
      lower(coalesce(cm.description, '')) LIKE ${raw}
      OR translate(lower(coalesce(cm.description, '')), 'áéíóúüñ', 'aeiouun') LIKE ${folded}
      OR lower(coalesce(cm.subcategory, '')) LIKE ${raw}
      OR translate(lower(coalesce(cm.subcategory, '')), 'áéíóúüñ', 'aeiouun') LIKE ${folded}
      OR lower(coalesce(cm.legacy_code, '')) LIKE ${raw}
      OR coalesce(mb.search_name, '') LIKE ${folded}
      OR lower(coalesce(mb.legacy_code, '')) LIKE ${raw}
    )`);
  }
  return Prisma.join(c, ' AND ');
}

export class PrismaCashMovementRepository implements CashMovementRepository {
  constructor(private readonly db: Db) {}

  private async fetch(ids: string[]): Promise<CashMovementRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.cashMovement.findMany({ where: { id: { in: ids } }, include });
    return orderByIds(ids, await toRecords(this.db, rows));
  }

  async findById(id: string): Promise<CashMovementRecord | null> {
    const row = await this.db.cashMovement.findUnique({ where: { id }, include });
    return row ? (await toRecords(this.db, [row]))[0]! : null;
  }

  async create(data: NewCashMovement): Promise<CashMovementRecord> {
    const row = await this.db.cashMovement.create({
      data: {
        legacyCode: data.legacyCode,
        occurredOn: fromDateOnly(data.occurredOn),
        type: data.type,
        categoryId: data.categoryId,
        subcategory: data.subcategory,
        amount: data.amount,
        description: data.description,
        memberId: data.memberId,
        origin: data.origin,
        createdById: data.createdById,
        updatedById: data.createdById,
        splits: { create: data.splits.map((s, i) => ({ method: s.method, amount: s.amount, sortOrder: i })) },
      },
      include,
    });
    return (await toRecords(this.db, [row]))[0]!;
  }

  async update(id: string, patch: CashMovementPatch): Promise<CashMovementRecord> {
    const data: Prisma.CashMovementUncheckedUpdateInput = {};
    if (patch.occurredOn !== undefined) data.occurredOn = fromDateOnly(patch.occurredOn);
    if (patch.categoryId !== undefined) data.categoryId = patch.categoryId;
    if (patch.subcategory !== undefined) data.subcategory = patch.subcategory;
    if (patch.amount !== undefined) data.amount = patch.amount;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.memberId !== undefined) data.memberId = patch.memberId;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.voidedAt !== undefined) data.voidedAt = patch.voidedAt;
    if (patch.voidedById !== undefined) data.voidedById = patch.voidedById;
    if (patch.voidReason !== undefined) data.voidReason = patch.voidReason;
    if (patch.updatedById !== undefined) data.updatedById = patch.updatedById;
    if (patch.splits !== undefined) {
      data.splits = {
        deleteMany: {},
        create: patch.splits.map((s, i) => ({ method: s.method, amount: s.amount, sortOrder: i })),
      };
    }
    const row = await this.db.cashMovement.update({ where: { id }, data, include });
    return (await toRecords(this.db, [row]))[0]!;
  }

  async list(filter: CashFilter, page: PageRequest, expandSplits: boolean): Promise<Paged<CashMovementRowRecord>> {
    const where = cashWhere(filter);
    const offset = (page.page - 1) * page.pageSize;
    if (expandSplits) {
      const [rows, countRows] = await Promise.all([
        this.db.$queryRaw<{ movement_id: string; method: string; split_amount: string; split_count: number; split_index: number }[]>`
          SELECT cm.id::text AS movement_id, s.method::text AS method, s.amount::text AS split_amount,
            (SELECT count(*) FROM cash_movement_splits s2 WHERE s2.cash_movement_id = cm.id)::int AS split_count,
            (SELECT count(*) FROM cash_movement_splits s3 WHERE s3.cash_movement_id = cm.id
               AND (s3.sort_order < s.sort_order OR (s3.sort_order = s.sort_order AND s3.id < s.id)))::int + 1 AS split_index
          ${FROM} WHERE ${where}
          ORDER BY cm.occurred_on DESC, cm.legacy_code DESC NULLS LAST, cm.created_at DESC, s.sort_order ASC, s.id ASC
          LIMIT ${page.pageSize} OFFSET ${offset}`,
        this.db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${FROM} WHERE ${where}`,
      ]);
      const movements = new Map((await this.fetch([...new Set(rows.map((r) => r.movement_id))])).map((m) => [m.id, m]));
      return {
        total: countRows[0]?.n ?? 0,
        items: rows
          .filter((r) => movements.has(r.movement_id))
          .map((r) => ({
            ...movements.get(r.movement_id)!,
            splitIndex: r.split_count > 1 ? r.split_index : null,
            method: r.method as PaymentMethod,
            rowAmount: Number(r.split_amount),
          })),
      };
    }
    const [rows, countRows] = await Promise.all([
      this.db.$queryRaw<{ movement_id: string; row_amount: string; method: string | null; split_count: number }[]>`
        SELECT cm.id::text AS movement_id, sum(s.amount)::text AS row_amount, min(s.method::text) AS method,
          (SELECT count(*) FROM cash_movement_splits s2 WHERE s2.cash_movement_id = cm.id)::int AS split_count
        ${FROM} WHERE ${where}
        GROUP BY cm.id
        ORDER BY cm.occurred_on DESC, cm.legacy_code DESC NULLS LAST, cm.created_at DESC
        LIMIT ${page.pageSize} OFFSET ${offset}`,
      this.db.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT cm.id)::int AS n ${FROM} WHERE ${where}`,
    ]);
    const ids = rows.map((r) => r.movement_id);
    const movements = new Map((await this.fetch(ids)).map((m) => [m.id, m]));
    return {
      total: countRows[0]?.n ?? 0,
      items: rows
        .filter((r) => movements.has(r.movement_id))
        .map((r) => ({
          ...movements.get(r.movement_id)!,
          splitIndex: null,
          method: r.split_count === 1 ? (r.method as PaymentMethod) : null,
          rowAmount: Number(r.row_amount),
        })),
    };
  }

  async totals(filter: CashFilter): Promise<CashTotalsRecord> {
    const where = cashWhere(filter);
    const [head, byMethod, byCategory] = await Promise.all([
      this.db.$queryRaw<{ income: string; expense: string; count: number; renewal_count: number }[]>`
        SELECT coalesce(sum(s.amount) FILTER (WHERE cm.type::text = 'INCOME'), 0)::text AS income,
               coalesce(sum(s.amount) FILTER (WHERE cm.type::text = 'EXPENSE'), 0)::text AS expense,
               count(DISTINCT cm.id)::int AS count,
               count(DISTINCT cm.id) FILTER (WHERE cm.origin::text = 'RENEWAL')::int AS renewal_count
        ${FROM} WHERE ${where}`,
      this.db.$queryRaw<{ type: string; method: string; total: string }[]>`
        SELECT cm.type::text AS type, s.method::text AS method, sum(s.amount)::text AS total
        ${FROM} WHERE ${where} GROUP BY cm.type, s.method ORDER BY sum(s.amount) DESC`,
      this.db.$queryRaw<{ type: string; category: string; total: string }[]>`
        SELECT cm.type::text AS type, c.name AS category, sum(s.amount)::text AS total
        ${FROM} WHERE ${where} GROUP BY cm.type, c.name ORDER BY sum(s.amount) DESC`,
    ]);
    const h = head[0]!;
    const pick = (rows: { type: string; total: string }[], type: string, key: (r: never) => string) =>
      Object.fromEntries(rows.filter((r) => r.type === type).map((r) => [key(r as never), Number(r.total)]));
    return {
      income: Number(h.income),
      expense: Number(h.expense),
      count: h.count,
      renewalCount: h.renewal_count,
      incomeByMethod: pick(byMethod, 'INCOME', (r: { method: string }) => r.method),
      expenseByMethod: pick(byMethod, 'EXPENSE', (r: { method: string }) => r.method),
      incomeByCategory: pick(byCategory, 'INCOME', (r: { category: string }) => r.category),
      expenseByCategory: pick(byCategory, 'EXPENSE', (r: { category: string }) => r.category),
    };
  }
}
