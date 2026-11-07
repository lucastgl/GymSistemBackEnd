import { attendanceRisk, suggestedTemplate } from '../../domain/attendances/attendance-risk';
import { isUpToDate, renewalStatus } from '../../domain/members/renewal-status';
import { Clock } from '../../domain/ports/ports';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { AttendanceFilter, AttendancePatch, Repositories } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { AttendanceRisk, RecordStatus, RenewalStatus } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText, fullName, normalizeSearchQuery } from '../../domain/shared/text';
import { attendanceLabel, attendanceSnapshot } from '../common/audit-snapshots';
import { loadSettings, pageRequest, requireUserId } from '../common/helpers';
import { AttendanceView, attendanceView, MemberView, memberView, PageView } from '../common/views';

const FUTURE_TOLERANCE_MS = 5 * 60_000;

function parseInstant(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw Errors.field(field, 'Fecha y hora inválidas (ISO 8601)', value);
  return d;
}

export interface ListAttendancesInput {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  memberId?: string;
  status?: RecordStatus;
}

/** GET /attendances (HU-ASI-03) con totales sobre el mismo filtro. */
export class ListAttendancesUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(
    input: ListAttendancesInput,
  ): Promise<PageView<AttendanceView> & { totals: { count: number; distinctMembers: number } }> {
    const page = pageRequest(input.page, input.pageSize);
    const filter: AttendanceFilter = {
      from: input.from ? DateOnly.parse(input.from, 'from') : null,
      to: input.to ? DateOnly.parse(input.to, 'to') : null,
      memberId: input.memberId ?? null,
      status: input.status ?? 'ACTIVE',
    };
    if (filter.from && filter.to && filter.from > filter.to) throw Errors.field('from', 'El rango de fechas es inválido (desde > hasta)');
    const [res, totals] = await Promise.all([this.repos.attendances.list(filter, page), this.repos.attendances.totals(filter)]);
    return { items: res.items.map(attendanceView), total: res.total, ...page, totals };
  }
}

/** GET /members/{id}/attendances. */
export class ListMemberAttendancesUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(memberId: string, q: { page?: number; pageSize?: number }): Promise<PageView<AttendanceView>> {
    const member = await this.repos.members.findById(memberId);
    if (!member || member.deletedAt !== null) throw Errors.notFound('Socio');
    const page = pageRequest(q.page, q.pageSize);
    const res = await this.repos.attendances.list({ from: null, to: null, memberId, status: null }, page);
    return { items: res.items.map(attendanceView), total: res.total, ...page };
  }
}

/**
 * POST /attendances (HU-ASI-01): hora del servidor en BA; `checked_in_on` lo calcula la app.
 * Duplicado el mismo día → 409 DUPLICATE_CHECKIN salvo `force`. Carga manual con nota obligatoria.
 */
export class CreateAttendanceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    ctx: RequestContext,
    input: { memberId: string; checkedInAt?: string; notes?: string; force?: boolean },
  ): Promise<AttendanceView> {
    requireUserId(ctx);
    const now = this.clock.now();
    const manual = input.checkedInAt !== undefined && input.checkedInAt !== null;
    const notes = cleanMultiline(input.notes ?? null);
    let checkedInAt = now;
    if (manual) {
      checkedInAt = parseInstant(input.checkedInAt as string, 'checkedInAt');
      if (checkedInAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
        throw Errors.field('checkedInAt', 'La asistencia no puede ser futura', input.checkedInAt);
      }
      if (!notes) throw Errors.field('notes', 'La carga manual requiere una nota');
    }
    const checkedInOn = this.clock.businessDateOf(checkedInAt);
    return this.uow.run(async (tx) => {
      const member = await tx.members.findById(input.memberId);
      if (!member || member.deletedAt !== null) throw Errors.notFound('Socio');
      if (member.status === 'CANCELLED') {
        throw Errors.conflict(ErrorCodes.MEMBER_CANCELLED, 'El socio está de baja. Reactivalo o registrá una renovación primero.');
      }
      if (!input.force) {
        const existing = await tx.attendances.findActiveOnDate(member.id, checkedInOn);
        if (existing) {
          throw Errors.conflict(ErrorCodes.DUPLICATE_CHECKIN, 'El socio ya registró asistencia ese día', [
            { field: 'existingCheckedInAt', message: 'Hora del check-in existente', value: existing.checkedInAt.toISOString() },
          ]);
        }
      }
      const created = await tx.attendances.create({
        memberId: member.id,
        checkedInAt,
        checkedInOn,
        source: manual ? 'MANUAL' : 'WEB',
        notes,
        createdById: ctx.actor.userId,
      });
      await tx.audit.log(
        { entity: 'ATTENDANCE', entityId: created.id, entityLabel: attendanceLabel(created), action: 'CREATE', after: attendanceSnapshot(created) },
        ctx,
      );
      return attendanceView(created);
    });
  }
}

/** PATCH /attendances/{id}: corregir socio, fecha/hora (con nota). */
export class UpdateAttendanceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    ctx: RequestContext,
    id: string,
    input: { memberId?: string; checkedInAt?: string; notes?: string },
  ): Promise<AttendanceView> {
    requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const current = await tx.attendances.findById(id);
      if (!current) throw Errors.notFound('Asistencia');
      if (current.status === 'VOIDED') throw Errors.conflict(ErrorCodes.RECORD_VOIDED, 'La asistencia está anulada');
      const patch: AttendancePatch = {};
      if (input.memberId !== undefined && input.memberId !== current.memberId) {
        const member = await tx.members.findById(input.memberId);
        if (!member || member.deletedAt !== null) throw Errors.notFound('Socio');
        patch.memberId = member.id;
      }
      if (input.checkedInAt !== undefined) {
        const at = parseInstant(input.checkedInAt, 'checkedInAt');
        if (at.getTime() > this.clock.now().getTime() + FUTURE_TOLERANCE_MS) {
          throw Errors.field('checkedInAt', 'La asistencia no puede ser futura', input.checkedInAt);
        }
        if (at.getTime() !== current.checkedInAt.getTime()) {
          patch.checkedInAt = at;
          patch.checkedInOn = this.clock.businessDateOf(at);
        }
      }
      if (input.notes !== undefined) patch.notes = cleanMultiline(input.notes);
      const finalNotes = patch.notes !== undefined ? patch.notes : current.notes;
      if ((patch.checkedInAt !== undefined || patch.memberId !== undefined) && !finalNotes) {
        throw Errors.field('notes', 'La corrección de socio o fecha/hora requiere una nota');
      }
      if (Object.keys(patch).length === 0) return attendanceView(current);
      patch.updatedById = ctx.actor.userId;
      const updated = await tx.attendances.update(id, patch);
      await tx.audit.log(
        {
          entity: 'ATTENDANCE',
          entityId: id,
          entityLabel: attendanceLabel(updated),
          action: 'UPDATE',
          before: attendanceSnapshot(current),
          after: attendanceSnapshot(updated),
        },
        ctx,
      );
      return attendanceView(updated);
    });
  }
}

/** POST /attendances/{id}/void. */
export class VoidAttendanceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string, input: { reason: string }): Promise<AttendanceView> {
    requireUserId(ctx);
    const reason = cleanText(input.reason);
    if (!reason || reason.length < 3) throw Errors.field('reason', 'Indicá el motivo de la anulación');
    return this.uow.run(async (tx) => {
      const current = await tx.attendances.findById(id);
      if (!current) throw Errors.notFound('Asistencia');
      if (current.status === 'VOIDED') throw Errors.conflict(ErrorCodes.RECORD_VOIDED, 'La asistencia ya está anulada');
      const updated = await tx.attendances.update(id, {
        status: 'VOIDED',
        voidedAt: this.clock.now(),
        voidedById: ctx.actor.userId,
        voidReason: reason,
        updatedById: ctx.actor.userId,
      });
      await tx.audit.log(
        {
          entity: 'ATTENDANCE',
          entityId: id,
          entityLabel: attendanceLabel(updated),
          action: 'VOID',
          before: attendanceSnapshot(current),
          after: attendanceSnapshot(updated),
        },
        ctx,
      );
      return attendanceView(updated);
    });
  }
}

export interface CheckInSuggestionView {
  id: string;
  legacyCode: string;
  fullName: string;
  planName: string | null;
  renewalStatus: RenewalStatus;
  isUpToDate: boolean;
  lastCheckInToday: string | null;
}

/** GET /attendances/search-members: socios no De baja; marca cuota vencida. */
export class SearchMembersForCheckInUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(q: string, limit?: number): Promise<CheckInSuggestionView[]> {
    const normalized = normalizeSearchQuery(q);
    if (!normalized) return [];
    const settings = await loadSettings(this.repos);
    const today = this.clock.today();
    const rows = await this.repos.members.searchForCheckIn(normalized, Math.min(Math.max(limit ?? 8, 1), 20), today);
    return rows.map((r) => {
      const status = renewalStatus(r, today, settings.renewalWarnDays);
      return {
        id: r.id,
        legacyCode: r.legacyCode,
        fullName: fullName(r.firstName, r.lastName),
        planName: r.planName,
        renewalStatus: status,
        isUpToDate: isUpToDate(status),
        lastCheckInToday: r.lastCheckInToday ? r.lastCheckInToday.toISOString() : null,
      };
    });
  }
}

export interface AttendanceRiskRowView {
  member: MemberView;
  lastAttendanceAt: string | null;
  daysSinceLastAttendance: number;
  neverAttended: boolean;
  risk: AttendanceRisk;
  suggestedTemplate: 'ausente' | 'inasistencia_alta' | 'inasistencia_critica';
}

/** GET /attendances/risk (HU-ASI-02): socios activos con cuota al día, ordenados por riesgo desc. */
export class ListAttendanceRiskUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(input: { page?: number; pageSize?: number; risk?: AttendanceRisk[]; q?: string }): Promise<PageView<AttendanceRiskRowView>> {
    const settings = await loadSettings(this.repos);
    const today = this.clock.today();
    const page = pageRequest(input.page, input.pageSize);
    const res = await this.repos.attendances.riskList({
      today,
      thresholds: settings.attendanceThresholds,
      risk: input.risk && input.risk.length > 0 ? input.risk : null,
      q: normalizeSearchQuery(input.q),
      page,
    });
    return {
      items: res.items.map((row) => {
        const r = attendanceRisk({ lastAttendanceOn: row.lastAttendanceOn, joinedAt: row.member.joinedAt }, today, settings.attendanceThresholds);
        return {
          member: memberView(row.member, today, settings.renewalWarnDays),
          lastAttendanceAt: row.lastAttendanceAt ? row.lastAttendanceAt.toISOString() : null,
          daysSinceLastAttendance: r.daysSinceLastAttendance,
          neverAttended: r.neverAttended,
          risk: r.risk,
          suggestedTemplate: suggestedTemplate(r.risk),
        };
      }),
      total: res.total,
      ...page,
    };
  }
}

/** GET /attendances/summary: tarjetas de inasistencia. */
export class GetAttendanceSummaryUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{
    activeUpToDate: number;
    ok: number;
    medium: number;
    high: number;
    critical: number;
    noAttendance: number;
    todayCheckIns: number;
    thresholds: number[];
  }> {
    const settings = await loadSettings(this.repos);
    const today = this.clock.today();
    const [counts, todayCheckIns] = await Promise.all([
      this.repos.attendances.riskSummary(today, settings.attendanceThresholds),
      this.repos.attendances.countOnDate(today),
    ]);
    return { ...counts, todayCheckIns, thresholds: settings.attendanceAlertDays };
  }
}
