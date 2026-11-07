import { IncentivePeriod, Prisma } from '@prisma/client';
import { IncentivePeriodRecord } from '../../../domain/repositories/records';
import {
  IncentiveMonthlyFactsRecord,
  IncentiveNewMemberRecord,
  IncentivesRepository,
  PublishedIncentivePeriodData,
} from '../../../domain/repositories/repositories';
import { DateOnly } from '../../../domain/shared/date-only';
import { StoredIncentivePeriodStatus } from '../../../domain/shared/enums';
import { Period } from '../../../domain/shared/period';
import { Db, num, numOrNull, toDateOnly, userRefs } from '../support';

/**
 * Altas con cobro (docs/03 §8.1 regla 1): primera membresía ACTIVE de cada socio
 * (`ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY starts_on, created_at, id) = 1`) cuyo
 * `joined_at` es igual o posterior a `since` (primer día del primer mes con datos). Cuenta en el
 * mes de su primer cobro (`starts_on` = fecha de pago).
 */
export function newMembersCte(since: DateOnly, from: DateOnly, to: DateOnly): Prisma.Sql {
  return Prisma.sql`WITH firsts AS (
      SELECT ms.member_id, ms.starts_on, ms.amount_total, ms.plan_name,
             ROW_NUMBER() OVER (PARTITION BY ms.member_id ORDER BY ms.starts_on, ms.created_at, ms.id) AS rn
      FROM memberships ms
      WHERE ms.status::text = 'ACTIVE'
    ), altas AS (
      SELECT f.member_id, f.starts_on, f.amount_total, f.plan_name,
             m.sold_by_staff_id, m.legacy_code, m.first_name, m.last_name
      FROM firsts f
      JOIN members m ON m.id = f.member_id
      WHERE f.rn = 1 AND m.deleted_at IS NULL AND m.joined_at >= ${since}::date
        AND f.starts_on BETWEEN ${from}::date AND ${to}::date
    )`;
}

const decimal = (value: number, digits: number): Prisma.Decimal => new Prisma.Decimal(value.toFixed(digits));

export class PrismaIncentivesRepository implements IncentivesRepository {
  constructor(private readonly db: Db) {}

  async monthlyFacts(from: Period, to: Period, newMemberSince: DateOnly): Promise<IncentiveMonthlyFactsRecord[]> {
    const ini = Period.first(from);
    const fin = Period.last(to);
    const [altas, payments, other, expenses] = await Promise.all([
      this.db.$queryRaw<{ period: string; staff_id: string | null; n: number; amount: string }[]>`${newMembersCte(newMemberSince, ini, fin)}
        SELECT to_char(a.starts_on, 'YYYY-MM') AS period, a.sold_by_staff_id::text AS staff_id,
               count(*)::int AS n, coalesce(sum(a.amount_total), 0)::text AS amount
        FROM altas a
        GROUP BY 1, 2`,
      this.db.$queryRaw<{ period: string; n: number; amount: string }[]>`
        SELECT to_char(ms.starts_on, 'YYYY-MM') AS period, count(*)::int AS n, coalesce(sum(ms.amount_total), 0)::text AS amount
        FROM memberships ms
        JOIN members m ON m.id = ms.member_id
        WHERE ms.status::text = 'ACTIVE' AND m.deleted_at IS NULL AND ms.starts_on BETWEEN ${ini}::date AND ${fin}::date
        GROUP BY 1`,
      this.db.$queryRaw<{ period: string; amount: string }[]>`
        SELECT to_char(cm.occurred_on, 'YYYY-MM') AS period, coalesce(sum(cm.amount), 0)::text AS amount
        FROM cash_movements cm
        WHERE cm.status::text = 'ACTIVE' AND cm.type::text = 'INCOME' AND cm.origin::text <> 'RENEWAL'
          AND cm.occurred_on BETWEEN ${ini}::date AND ${fin}::date
        GROUP BY 1`,
      this.db.$queryRaw<{ period: string; category_name: string; subcategory: string | null; n: number; amount: string }[]>`
        SELECT to_char(cm.occurred_on, 'YYYY-MM') AS period, c.name AS category_name, cm.subcategory,
               count(*)::int AS n, coalesce(sum(cm.amount), 0)::text AS amount
        FROM cash_movements cm
        JOIN cash_categories c ON c.id = cm.category_id
        WHERE cm.status::text = 'ACTIVE' AND cm.type::text = 'EXPENSE' AND cm.occurred_on BETWEEN ${ini}::date AND ${fin}::date
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3`,
    ]);
    const out = new Map<string, IncentiveMonthlyFactsRecord>(
      Period.range(from, to).map((p) => [p, { period: p, newMembersByStaff: [], payments: 0, paymentsAmount: 0, otherIncome: 0, expenseGroups: [] }]),
    );
    for (const r of altas) {
      out.get(r.period)?.newMembersByStaff.push({ staffId: r.staff_id, count: Number(r.n), amount: Number(r.amount) });
    }
    for (const r of payments) {
      const m = out.get(r.period);
      if (m) {
        m.payments = Number(r.n);
        m.paymentsAmount = Number(r.amount);
      }
    }
    for (const r of other) {
      const m = out.get(r.period);
      if (m) m.otherIncome = Number(r.amount);
    }
    for (const r of expenses) {
      out.get(r.period)?.expenseGroups.push({
        categoryName: r.category_name,
        subcategory: r.subcategory,
        amount: Number(r.amount),
        count: Number(r.n),
      });
    }
    return [...out.values()];
  }

  async newMembersInPeriod(period: Period, newMemberSince: DateOnly): Promise<IncentiveNewMemberRecord[]> {
    const rows = await this.db.$queryRaw<
      {
        member_id: string;
        legacy_code: string;
        first_name: string;
        last_name: string;
        starts_on: Date;
        amount: string;
        plan_name: string;
        staff_id: string | null;
        display_name: string | null;
      }[]
    >`${newMembersCte(newMemberSince, Period.first(period), Period.last(period))}
      SELECT a.member_id::text AS member_id, a.legacy_code, a.first_name, a.last_name, a.starts_on,
             a.amount_total::text AS amount, a.plan_name, s.id::text AS staff_id, s.display_name
      FROM altas a
      LEFT JOIN staff_members s ON s.id = a.sold_by_staff_id
      ORDER BY a.starts_on, a.legacy_code`;
    return rows.map((r) => ({
      memberId: r.member_id,
      legacyCode: r.legacy_code,
      firstName: r.first_name,
      lastName: r.last_name,
      paidOn: toDateOnly(r.starts_on),
      amount: Number(r.amount),
      planName: r.plan_name,
      soldBy: r.staff_id ? { id: r.staff_id, displayName: r.display_name ?? '' } : null,
    }));
  }

  async lastPaymentOn(period: Period): Promise<DateOnly | null> {
    const rows = await this.db.$queryRaw<{ d: Date | null }[]>`
      SELECT max(ms.starts_on) AS d
      FROM memberships ms
      JOIN members m ON m.id = ms.member_id
      WHERE ms.status::text = 'ACTIVE' AND m.deleted_at IS NULL
        AND ms.starts_on BETWEEN ${Period.first(period)}::date AND ${Period.last(period)}::date`;
    const d = rows[0]?.d ?? null;
    return d ? toDateOnly(d) : null;
  }

  private async toRecords(rows: IncentivePeriod[]): Promise<IncentivePeriodRecord[]> {
    const users = await userRefs(this.db, rows.flatMap((r) => [r.publishedById, r.closedById]));
    const ref = (id: string | null) => (id ? (users.get(id) ?? null) : null);
    return rows.map((r) => ({
      id: r.id,
      period: r.period.trim(),
      status: r.status as StoredIncentivePeriodStatus,
      formulaVersion: r.formulaVersion,
      newMembersTarget: r.newMembersTarget,
      renewalRateTargetPct: num(r.renewalRateTargetPct),
      expectedExpirations: r.expectedExpirations,
      renewalsTarget: r.renewalsTarget,
      bonusPerNewMemberArs: num(r.bonusPerNewMemberArs),
      teamBonusPerPersonArs: num(r.teamBonusPerPersonArs),
      expenseReferenceArs: numOrNull(r.expenseReferenceArs),
      plan: r.plan,
      results: r.results ?? null,
      notes: r.notes,
      publishedAt: r.publishedAt,
      publishedBy: ref(r.publishedById),
      closedAt: r.closedAt,
      closedBy: ref(r.closedById),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async findPeriod(period: Period): Promise<IncentivePeriodRecord | null> {
    const row = await this.db.incentivePeriod.findUnique({ where: { period } });
    return row ? (await this.toRecords([row]))[0]! : null;
  }

  async listPeriods(from: Period, to: Period): Promise<IncentivePeriodRecord[]> {
    const rows = await this.db.incentivePeriod.findMany({ where: { period: { gte: from, lte: to } }, orderBy: { period: 'asc' } });
    return this.toRecords(rows);
  }

  async savePublished(data: PublishedIncentivePeriodData): Promise<IncentivePeriodRecord> {
    const fields = {
      status: 'PUBLISHED' as const,
      formulaVersion: data.formulaVersion,
      newMembersTarget: data.newMembersTarget,
      renewalRateTargetPct: decimal(data.renewalRateTargetPct, 4),
      expectedExpirations: data.expectedExpirations,
      renewalsTarget: data.renewalsTarget,
      bonusPerNewMemberArs: decimal(data.bonusPerNewMemberArs, 2),
      teamBonusPerPersonArs: decimal(data.teamBonusPerPersonArs, 2),
      expenseReferenceArs: data.expenseReferenceArs === null ? null : decimal(data.expenseReferenceArs, 2),
      plan: data.plan as Prisma.InputJsonValue,
      results: Prisma.DbNull,
      notes: data.notes,
      publishedAt: data.publishedAt,
      publishedById: data.publishedById,
      closedAt: null,
      closedById: null,
    };
    const row = await this.db.incentivePeriod.upsert({
      where: { period: data.period },
      create: { period: data.period, ...fields },
      update: fields,
    });
    return (await this.toRecords([row]))[0]!;
  }

  async saveClosed(
    period: Period,
    data: { results: unknown; closedAt: Date; closedById: string | null; notes: string | null },
  ): Promise<IncentivePeriodRecord> {
    const row = await this.db.incentivePeriod.update({
      where: { period },
      data: {
        status: 'CLOSED',
        results: data.results as Prisma.InputJsonValue,
        closedAt: data.closedAt,
        closedById: data.closedById,
        notes: data.notes,
      },
    });
    return (await this.toRecords([row]))[0]!;
  }
}
