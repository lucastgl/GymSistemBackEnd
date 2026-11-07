import { Prisma } from '@prisma/client';
import { AttendanceThresholds } from '../../../domain/attendances/attendance-risk';
import { AttendanceRecord } from '../../../domain/repositories/records';
import {
  AttendanceFilter,
  AttendancePatch,
  AttendanceRepository,
  AttendanceRiskCounts,
  AttendanceRiskQuery,
  AttendanceRiskRowRecord,
  NewAttendance,
  PageRequest,
  Paged,
} from '../../../domain/repositories/repositories';
import { DateOnly } from '../../../domain/shared/date-only';
import { AttendanceSource, RecordStatus } from '../../../domain/shared/enums';
import {
  auditMeta,
  Db,
  fromDateOnly,
  likePattern,
  memberRef,
  memberSelect,
  orderByIds,
  toDateOnly,
  toDateOnlyOrNull,
  userRefs,
} from '../support';
import { memberInclude, toMemberRecords } from './member.repository';

const include = { member: { select: memberSelect } } satisfies Prisma.AttendanceInclude;
type Row = Prisma.AttendanceGetPayload<{ include: typeof include }>;

async function toRecords(db: Db, rows: Row[]): Promise<AttendanceRecord[]> {
  const users = await userRefs(db, rows.flatMap((r) => [r.createdById, r.updatedById]));
  return rows.map((a) => ({
    id: a.id,
    memberId: a.memberId,
    member: memberRef(a.member),
    checkedInAt: a.checkedInAt,
    checkedInOn: toDateOnly(a.checkedInOn),
    source: a.source as AttendanceSource,
    notes: a.notes,
    status: a.status as RecordStatus,
    voidedAt: a.voidedAt,
    voidReason: a.voidReason,
    audit: auditMeta(users, a),
  }));
}

function whereOf(f: AttendanceFilter): Prisma.AttendanceWhereInput {
  return {
    ...(f.memberId ? { memberId: f.memberId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from || f.to
      ? { checkedInOn: { ...(f.from ? { gte: fromDateOnly(f.from) } : {}), ...(f.to ? { lte: fromDateOnly(f.to) } : {}) } }
      : {}),
  };
}

function whereSql(f: AttendanceFilter): Prisma.Sql {
  const c: Prisma.Sql[] = [Prisma.sql`true`];
  if (f.memberId) c.push(Prisma.sql`a.member_id = ${f.memberId}::uuid`);
  if (f.status) c.push(Prisma.sql`a.status::text = ${f.status}`);
  if (f.from) c.push(Prisma.sql`a.checked_in_on >= ${f.from}::date`);
  if (f.to) c.push(Prisma.sql`a.checked_in_on <= ${f.to}::date`);
  return Prisma.join(c, ' AND ');
}

/** Base del riesgo de inasistencia: socios ACTIVE, no anulados, con cuota al día (vence hoy o después). */
function riskBase(today: DateOnly, t: AttendanceThresholds): Prisma.Sql {
  return Prisma.sql`WITH la AS (
      SELECT member_id, max(checked_in_at) AS last_at, max(checked_in_on) AS last_on
      FROM attendances WHERE status::text = 'ACTIVE' GROUP BY member_id
    ), base AS (
      SELECT m.id, m.last_name, m.first_name, m.search_name, m.legacy_code, la.last_at, la.last_on,
        (${today}::date - coalesce(la.last_on, m.joined_at)) AS days,
        CASE WHEN la.last_on IS NULL THEN 'NO_ATTENDANCE'
             WHEN (${today}::date - la.last_on) > ${t.critical}::int THEN 'CRITICAL'
             WHEN (${today}::date - la.last_on) > ${t.high}::int THEN 'HIGH'
             WHEN (${today}::date - la.last_on) > ${t.medium}::int THEN 'MEDIUM'
             ELSE 'OK' END AS risk
      FROM members m LEFT JOIN la ON la.member_id = m.id
      WHERE m.deleted_at IS NULL AND m.status::text = 'ACTIVE' AND m.expires_at >= ${today}::date
    )`;
}

export class PrismaAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<AttendanceRecord | null> {
    const row = await this.db.attendance.findUnique({ where: { id }, include });
    return row ? (await toRecords(this.db, [row]))[0]! : null;
  }

  async create(data: NewAttendance): Promise<AttendanceRecord> {
    const row = await this.db.attendance.create({
      data: {
        memberId: data.memberId,
        checkedInAt: data.checkedInAt,
        checkedInOn: fromDateOnly(data.checkedInOn),
        source: data.source,
        notes: data.notes,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
      include,
    });
    return (await toRecords(this.db, [row]))[0]!;
  }

  async update(id: string, patch: AttendancePatch): Promise<AttendanceRecord> {
    const data: Prisma.AttendanceUncheckedUpdateInput = {};
    if (patch.memberId !== undefined) data.memberId = patch.memberId;
    if (patch.checkedInAt !== undefined) data.checkedInAt = patch.checkedInAt;
    if (patch.checkedInOn !== undefined) data.checkedInOn = fromDateOnly(patch.checkedInOn);
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.voidedAt !== undefined) data.voidedAt = patch.voidedAt;
    if (patch.voidedById !== undefined) data.voidedById = patch.voidedById;
    if (patch.voidReason !== undefined) data.voidReason = patch.voidReason;
    if (patch.updatedById !== undefined) data.updatedById = patch.updatedById;
    const row = await this.db.attendance.update({ where: { id }, data, include });
    return (await toRecords(this.db, [row]))[0]!;
  }

  async findActiveOnDate(memberId: string, date: DateOnly, excludeId?: string): Promise<AttendanceRecord | null> {
    const row = await this.db.attendance.findFirst({
      where: { memberId, checkedInOn: fromDateOnly(date), status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) },
      include,
      orderBy: { checkedInAt: 'asc' },
    });
    return row ? (await toRecords(this.db, [row]))[0]! : null;
  }

  async list(filter: AttendanceFilter, page: PageRequest): Promise<Paged<AttendanceRecord>> {
    const where = whereOf(filter);
    const [rows, total] = await Promise.all([
      this.db.attendance.findMany({
        where,
        include,
        orderBy: [{ checkedInAt: 'desc' }, { id: 'asc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.attendance.count({ where }),
    ]);
    return { items: await toRecords(this.db, rows), total };
  }

  async totals(filter: AttendanceFilter): Promise<{ count: number; distinctMembers: number }> {
    const rows = await this.db.$queryRaw<{ count: number; distinct_members: number }[]>`
      SELECT count(*)::int AS count, count(DISTINCT a.member_id)::int AS distinct_members
      FROM attendances a WHERE ${whereSql(filter)}`;
    return { count: rows[0]?.count ?? 0, distinctMembers: rows[0]?.distinct_members ?? 0 };
  }

  async lastActive(memberId: string): Promise<{ checkedInAt: Date; checkedInOn: DateOnly } | null> {
    const row = await this.db.attendance.findFirst({
      where: { memberId, status: 'ACTIVE' },
      orderBy: { checkedInAt: 'desc' },
      select: { checkedInAt: true, checkedInOn: true },
    });
    return row ? { checkedInAt: row.checkedInAt, checkedInOn: toDateOnly(row.checkedInOn) } : null;
  }

  async riskList(query: AttendanceRiskQuery): Promise<Paged<AttendanceRiskRowRecord>> {
    const c: Prisma.Sql[] = [Prisma.sql`true`];
    if (query.risk) c.push(Prisma.sql`risk IN (${Prisma.join(query.risk)})`);
    if (query.q) {
      const p = likePattern(query.q);
      c.push(Prisma.sql`(search_name LIKE ${p} OR lower(legacy_code) LIKE ${p})`);
    }
    const where = Prisma.join(c, ' AND ');
    const base = riskBase(query.today, query.thresholds);
    const offset = (query.page.page - 1) * query.page.pageSize;
    const [rows, countRows] = await Promise.all([
      this.db.$queryRaw<{ id: string; last_at: Date | null; last_on: Date | null }[]>`${base}
        SELECT id::text AS id, last_at, last_on FROM base WHERE ${where}
        ORDER BY CASE risk WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'NO_ATTENDANCE' THEN 3 ELSE 4 END,
          days DESC, last_name ASC, first_name ASC, id ASC
        LIMIT ${query.page.pageSize} OFFSET ${offset}`,
      this.db.$queryRaw<{ n: number }[]>`${base} SELECT count(*)::int AS n FROM base WHERE ${where}`,
    ]);
    const ids = rows.map((r) => r.id);
    const members = ids.length
      ? orderByIds(
          ids,
          await toMemberRecords(
            this.db,
            await this.db.member.findMany({ where: { id: { in: ids } }, include: memberInclude }),
          ),
        )
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      total: countRows[0]?.n ?? 0,
      items: members.map((m) => ({
        member: m,
        lastAttendanceAt: byId.get(m.id)?.last_at ?? null,
        lastAttendanceOn: toDateOnlyOrNull(byId.get(m.id)?.last_on ?? null),
      })),
    };
  }

  async riskSummary(today: DateOnly, thresholds: AttendanceThresholds): Promise<AttendanceRiskCounts> {
    const rows = await this.db.$queryRaw<
      { active: number; ok: number; medium: number; high: number; critical: number; no_attendance: number }[]
    >`${riskBase(today, thresholds)}
      SELECT count(*)::int AS active,
        count(*) FILTER (WHERE risk = 'OK')::int AS ok,
        count(*) FILTER (WHERE risk = 'MEDIUM')::int AS medium,
        count(*) FILTER (WHERE risk = 'HIGH')::int AS high,
        count(*) FILTER (WHERE risk = 'CRITICAL')::int AS critical,
        count(*) FILTER (WHERE risk = 'NO_ATTENDANCE')::int AS no_attendance
      FROM base`;
    const r = rows[0]!;
    return { activeUpToDate: r.active, ok: r.ok, medium: r.medium, high: r.high, critical: r.critical, noAttendance: r.no_attendance };
  }

  async countOnDate(date: DateOnly): Promise<number> {
    return this.db.attendance.count({ where: { checkedInOn: fromDateOnly(date), status: 'ACTIVE' } });
  }
}
