import { Prisma } from '@prisma/client';
import { AuditRecord } from '../../../domain/audit/audit-entry';
import { AuditLogRecord, JobRunRecord } from '../../../domain/repositories/records';
import {
  AuditLogFilter,
  AuditLogRepository,
  JobRunRepository,
  PageRequest,
  Paged,
  SequenceName,
  SequenceRepository,
} from '../../../domain/repositories/repositories';
import { AuditAction, AuditEntity, JobName } from '../../../domain/shared/enums';
import { Db, jsonOrDbNull } from '../support';

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Db) {}

  async insert(r: AuditRecord): Promise<void> {
    await this.db.auditLog.create({
      data: {
        occurredAt: r.occurredAt,
        userId: r.userId,
        actorLabel: r.actorLabel,
        entity: r.entity,
        entityId: r.entityId,
        entityLabel: r.entityLabel,
        action: r.action,
        before: jsonOrDbNull(r.before),
        after: jsonOrDbNull(r.after),
        changedFields: r.changedFields,
        passwordConfirmed: r.passwordConfirmed,
        requestId: r.requestId,
        ip: r.ip,
        userAgent: r.userAgent,
      },
    });
  }

  async list(f: AuditLogFilter, page: PageRequest): Promise<Paged<AuditLogRecord>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(f.entity ? { entity: f.entity } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.action ? { action: f.action } : {}),
      ...(f.userId ? { userId: f.userId } : {}),
      ...(f.from || f.to ? { occurredAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true } } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.auditLog.count({ where }),
    ]);
    return {
      total,
      items: rows.map((a) => ({
        id: a.id,
        occurredAt: a.occurredAt,
        user: a.user ? { id: a.user.id, fullName: a.user.fullName } : null,
        actorLabel: a.actorLabel,
        entity: a.entity as AuditEntity,
        entityId: a.entityId,
        entityLabel: a.entityLabel,
        action: a.action as AuditAction,
        before: (a.before as Record<string, unknown> | null) ?? null,
        after: (a.after as Record<string, unknown> | null) ?? null,
        changedFields: a.changedFields,
        passwordConfirmed: a.passwordConfirmed,
        requestId: a.requestId,
      })),
    };
  }
}

export class PrismaJobRunRepository implements JobRunRepository {
  constructor(private readonly db: Db) {}

  async start(job: JobName, at: Date): Promise<string> {
    return (await this.db.jobRun.create({ data: { job, startedAt: at, status: 'RUNNING' }, select: { id: true } })).id;
  }

  async finish(id: string, status: 'OK' | 'ERROR', at: Date, result: unknown, error: string | null): Promise<void> {
    await this.db.jobRun.update({ where: { id }, data: { status, finishedAt: at, result: jsonOrDbNull(result), error } });
  }

  async lastFinished(job: JobName, status: 'OK' | 'ERROR'): Promise<JobRunRecord | null> {
    const r = await this.db.jobRun.findFirst({ where: { job, status }, orderBy: { startedAt: 'desc' } });
    return r
      ? { id: r.id, job: r.job, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, result: r.result, error: r.error }
      : null;
  }
}

const SEQUENCES: Record<SequenceName, string> = {
  member: 'member_code_seq',
  membership: 'membership_code_seq',
  movement: 'movement_code_seq',
  lead: 'lead_code_seq',
};

/** Códigos legacy por secuencia (04 §3.9): `SELECT nextval('…')`. */
export class PrismaSequenceRepository implements SequenceRepository {
  constructor(private readonly db: Db) {}

  async next(name: SequenceName): Promise<number> {
    const seq = SEQUENCES[name];
    const rows = await this.db.$queryRaw<{ n: bigint }[]>`SELECT nextval(${seq}::regclass) AS n`;
    return Number(rows[0]!.n);
  }
}
