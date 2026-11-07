import { MetricSnapshot, Prisma } from '@prisma/client';
import { MetricsDataset } from '../../../domain/metrics/metrics-calculator';
import { MetricSnapshotRecord, MetricValueRecord } from '../../../domain/repositories/records';
import { MetricsRepository, NewSnapshot } from '../../../domain/repositories/repositories';
import { DateOnly } from '../../../domain/shared/date-only';
import {
  LeadStage,
  MemberStatusEventType,
  MethodologyVersion,
  MovementOrigin,
  MovementType,
  PaymentMethod,
  SnapshotSource,
  SnapshotStage,
} from '../../../domain/shared/enums';
import { Period } from '../../../domain/shared/period';
import { Db, fromDateOnly, num, numOrNull, toDateOnly, toDateOnlyOrNull } from '../support';

function toSnapshot(s: MetricSnapshot): MetricSnapshotRecord {
  return {
    id: s.id,
    period: s.period.trim(),
    closedAt: s.closedAt,
    closedByUserId: s.closedByUserId,
    closedByName: s.closedByName,
    source: s.source as SnapshotSource,
    stage: s.stage as SnapshotStage,
    isCurrent: s.isCurrent,
    supersededAt: s.supersededAt,
    legacyLabel: s.legacyLabel,
    notes: s.notes,
  };
}

export class PrismaMetricsRepository implements MetricsRepository {
  constructor(private readonly db: Db) {}

  /** Datos crudos del período para la calculadora V1 (el cálculo vive en el dominio). */
  async loadDataset(period: Period, graceDays: number): Promise<MetricsDataset> {
    const ini = fromDateOnly(Period.first(period));
    const fin = fromDateOnly(Period.last(period));
    const finPlusGrace = fromDateOnly(DateOnly.addDays(Period.last(period), graceDays));
    const [members, events, memberships, movements, attendances, leads, priorMemberships, attendanceUpTo, leadsUpTo] =
      await Promise.all([
        this.db.member.findMany({
          where: { deletedAt: null },
          select: { id: true, joinedAt: true, lastRenewalAt: true, expiresAt: true, _count: { select: { memberships: true } } },
        }),
        this.db.memberStatusEvent.findMany({
          where: { effectiveOn: { lte: fin }, member: { deletedAt: null } },
          select: { memberId: true, type: true, effectiveOn: true },
          orderBy: [{ effectiveOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        }),
        this.db.membership.findMany({
          where: { status: 'ACTIVE', startsOn: { lte: finPlusGrace }, member: { deletedAt: null } },
          select: { id: true, memberId: true, startsOn: true, expiresOn: true },
        }),
        this.db.cashMovement.findMany({
          where: { status: 'ACTIVE', occurredOn: { gte: ini, lte: fin } },
          select: {
            type: true,
            origin: true,
            amount: true,
            category: { select: { name: true } },
            splits: { select: { method: true, amount: true } },
          },
        }),
        this.db.attendance.findMany({
          where: { status: 'ACTIVE', checkedInOn: { gte: ini, lte: fin }, member: { deletedAt: null } },
          select: { memberId: true, checkedInOn: true },
        }),
        this.db.lead.findMany({
          where: { deletedAt: null, contactedOn: { gte: ini, lte: fin } },
          select: { stage: true, contactedOn: true },
        }),
        this.db.membership.count({ where: { status: 'ACTIVE', startsOn: { lt: ini } } }),
        this.db.attendance.count({ where: { status: 'ACTIVE', checkedInOn: { lte: fin } } }),
        this.db.lead.count({ where: { deletedAt: null, contactedOn: { lte: fin } } }),
      ]);
    return {
      period,
      members: members.map((m) => ({
        id: m.id,
        joinedAt: toDateOnly(m.joinedAt),
        hasMemberships: m._count.memberships > 0,
        lastRenewalAt: toDateOnlyOrNull(m.lastRenewalAt),
        expiresAt: toDateOnlyOrNull(m.expiresAt),
      })),
      statusEvents: events.map((e, seq) => ({
        memberId: e.memberId,
        type: e.type as MemberStatusEventType,
        effectiveOn: toDateOnly(e.effectiveOn),
        seq,
      })),
      memberships: memberships.map((m) => ({
        id: m.id,
        memberId: m.memberId,
        startsOn: toDateOnly(m.startsOn),
        expiresOn: toDateOnly(m.expiresOn),
      })),
      movements: movements.map((mv) => ({
        type: mv.type as MovementType,
        origin: mv.origin as MovementOrigin,
        amount: num(mv.amount),
        categoryName: mv.category.name,
        splits: mv.splits.map((s) => ({ method: s.method as PaymentMethod, amount: num(s.amount) })),
      })),
      attendances: attendances.map((a) => ({ memberId: a.memberId, checkedInOn: toDateOnly(a.checkedInOn) })),
      leads: leads.map((l) => ({ stage: l.stage as LeadStage, contactedOn: toDateOnly(l.contactedOn) })),
      availability: {
        hasPriorMembershipData: priorMemberships > 0,
        attendanceTracked: attendanceUpTo > 0,
        leadsTracked: leadsUpTo > 0,
      },
    };
  }

  async firstDataPeriod(): Promise<Period | null> {
    const rows = await this.db.$queryRaw<{ d: Date | null }[]>`SELECT least(
        (SELECT min(starts_on) FROM memberships WHERE status::text = 'ACTIVE'),
        (SELECT min(occurred_on) FROM cash_movements WHERE status::text = 'ACTIVE')
      ) AS d`;
    const d = rows[0]?.d ?? null;
    return d ? Period.ofDate(DateOnly.fromUtcDate(d)) : null;
  }

  async findCurrentSnapshot(period: Period): Promise<{ snapshot: MetricSnapshotRecord; values: MetricValueRecord[] } | null> {
    const s = await this.db.metricSnapshot.findFirst({
      where: { period, isCurrent: true, stage: { in: ['PRELIMINARY', 'FINAL'] } },
      orderBy: { closedAt: 'desc' },
      include: { values: true },
    });
    if (!s) return null;
    return {
      snapshot: toSnapshot(s),
      values: s.values.map((v) => ({
        metricKey: v.metricKey,
        value: numOrNull(v.value),
        methodologyVersion: v.methodologyVersion as MethodologyVersion,
        isProvisional: v.isProvisional,
      })),
    };
  }

  async currentStages(): Promise<Map<string, 'PRELIMINARY' | 'FINAL'>> {
    const rows = await this.db.metricSnapshot.findMany({
      where: { isCurrent: true, stage: { in: ['PRELIMINARY', 'FINAL'] } },
      select: { period: true, stage: true },
    });
    return new Map(rows.map((r) => [r.period.trim(), r.stage as 'PRELIMINARY' | 'FINAL']));
  }

  async listSnapshots(period: Period | null): Promise<MetricSnapshotRecord[]> {
    const rows = await this.db.metricSnapshot.findMany({
      where: period ? { period } : {},
      orderBy: [{ period: 'desc' }, { closedAt: 'desc' }],
    });
    return rows.map(toSnapshot);
  }

  async supersede(snapshotId: string, at: Date): Promise<void> {
    await this.db.metricSnapshot.update({ where: { id: snapshotId }, data: { isCurrent: false, supersededAt: at } });
  }

  async createSnapshot(data: NewSnapshot): Promise<MetricSnapshotRecord> {
    const s = await this.db.metricSnapshot.create({
      data: {
        period: data.period,
        closedAt: data.closedAt,
        closedByUserId: data.closedByUserId,
        closedByName: data.closedByName,
        source: data.source,
        stage: data.stage,
        isCurrent: true,
        notes: data.notes,
        values: {
          create: data.values.map((v) => ({
            metricKey: v.metricKey,
            value: v.value === null ? null : new Prisma.Decimal(v.value.toFixed(4)),
            methodologyVersion: v.methodologyVersion,
            isProvisional: v.isProvisional,
            computedAt: data.closedAt,
          })),
        },
      },
    });
    return toSnapshot(s);
  }

  /**
   * "N cambios posteriores al cierre" (HU-MET-03): registros de auditoría posteriores al cierre
   * cuya fecha de negocio (antes o después del cambio) cae en el período. El movimiento de caja
   * de una renovación no se cuenta aparte (ya cuenta la membresía).
   */
  async countChangesAfterClose(period: Period, closedAt: Date): Promise<number> {
    const p = `${period}-%`;
    const rows = await this.db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_logs a
      WHERE a.occurred_at > ${closedAt}
        AND a.action::text IN ('CREATE', 'UPDATE', 'VOID', 'DELETE', 'CANCEL', 'REACTIVATE')
        AND (
          (a.entity::text = 'MEMBERSHIP' AND (a.after->>'startsOn' LIKE ${p} OR a.before->>'startsOn' LIKE ${p}))
          OR (a.entity::text = 'CASH_MOVEMENT' AND coalesce(a.after->>'origin', a.before->>'origin') <> 'RENEWAL'
              AND (a.after->>'occurredOn' LIKE ${p} OR a.before->>'occurredOn' LIKE ${p}))
          OR (a.entity::text = 'ATTENDANCE' AND (a.after->>'checkedInOn' LIKE ${p} OR a.before->>'checkedInOn' LIKE ${p}))
          OR (a.entity::text = 'LEAD' AND (a.after->>'contactedOn' LIKE ${p} OR a.before->>'contactedOn' LIKE ${p}))
          OR (a.entity::text = 'MEMBER' AND a.action::text IN ('CREATE', 'DELETE') AND coalesce(a.after->>'joinedAt', a.before->>'joinedAt') LIKE ${p})
          OR (a.entity::text = 'MEMBER' AND a.action::text = 'CANCEL' AND a.after->>'cancelledAt' LIKE ${p})
        )`;
    return rows[0]?.n ?? 0;
  }
}
