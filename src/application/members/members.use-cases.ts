import { autoCancelCutoff, selectAutoCancellations } from '../../domain/members/auto-cancel';
import { buildWhatsappLink } from '../../domain/members/whatsapp';
import { pickCurrentMembership } from '../../domain/memberships/membership-rules';
import { Clock, LabelCatalog } from '../../domain/ports/ports';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { StaffMemberRecord } from '../../domain/repositories/records';
import { MemberPatch, MemberSort, Repositories } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { MemberStatus, RenewalStatus, WhatsappTemplate } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { PhoneNumber } from '../../domain/shared/phone-number';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText, formatCode, fullName, normalizeSearchQuery, searchName } from '../../domain/shared/text';
import { memberLabel, memberSnapshot } from '../common/audit-snapshots';
import { loadSettings, pageRequest, requireUserId } from '../common/helpers';
import {
  MemberDetailView,
  memberDetailView,
  MemberStatusEventView,
  MemberView,
  memberView,
  MembershipView,
  membershipView,
  PageView,
  statusEventView,
} from '../common/views';
import { MembershipPaymentInput, MembershipService, resolvePlanForMember } from '../memberships/membership-service';
import { JobRunner } from '../jobs/job-runner';

async function getLiveMember(repos: Pick<Repositories, 'members'>, id: string) {
  const member = await repos.members.findById(id);
  if (!member || member.deletedAt !== null) throw Errors.notFound('Socio');
  return member;
}

function nameOrThrow(value: string | undefined | null, field: string, label: string): string {
  const v = cleanText(value);
  if (!v) throw Errors.field(field, `${label} es obligatorio`);
  return v;
}

/**
 * 'Vendido por' (Fase 4): la persona tiene que existir y estar activa. 400 VALIDATION_ERROR si no
 * existe, 400 STAFF_INACTIVE si está inactiva.
 */
async function requireActiveStaff(repos: Pick<Repositories, 'staff'>, staffId: string): Promise<StaffMemberRecord> {
  const staff = await repos.staff.findById(staffId);
  if (!staff) throw Errors.field('soldByStaffId', 'La persona del equipo no existe', staffId);
  if (!staff.isActive) {
    throw Errors.fieldCode(ErrorCodes.STAFF_INACTIVE, 'soldByStaffId', `La persona elegida (${staff.displayName}) no está activa en el equipo: elegí otra`, staffId);
  }
  return staff;
}

/** Default del alta: la persona del equipo vinculada al usuario autenticado. */
async function resolveSoldByForCreate(
  repos: Pick<Repositories, 'staff'>,
  ctx: RequestContext,
  staffId: string | null | undefined,
): Promise<StaffMemberRecord> {
  if (staffId) return requireActiveStaff(repos, staffId);
  const own = ctx.actor.userId ? await repos.staff.findByUserId(ctx.actor.userId) : null;
  if (!own) {
    throw Errors.field('soldByStaffId', 'Indicá quién cerró la venta: tu usuario no está vinculado a ninguna persona del equipo');
  }
  if (!own.isActive) {
    throw Errors.fieldCode(ErrorCodes.STAFF_INACTIVE, 'soldByStaffId', `La persona vinculada a tu usuario (${own.displayName}) no está activa en el equipo: elegí quién cerró la venta`, own.id);
  }
  return own;
}

function normalizeEmailOrNull(value: string | null | undefined): string | null {
  const v = cleanText(value);
  return v ? v.toLowerCase() : null;
}

// ───────────── Lectura ─────────────

export interface ListMembersInput {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: MemberStatus;
  renewalStatus?: RenewalStatus[];
  planId?: string;
  renewedFrom?: string;
  renewedTo?: string;
  sort?: MemberSort;
  order?: 'asc' | 'desc';
}

/** GET /members (HU-SOC-01): orden por prioridad de cuota resuelto en SQL. */
export class ListMembersUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(input: ListMembersInput): Promise<PageView<MemberView>> {
    const settings = await loadSettings(this.repos);
    const today = this.clock.today();
    const page = pageRequest(input.page, input.pageSize);
    const renewedFrom = input.renewedFrom ? DateOnly.parse(input.renewedFrom, 'renewedFrom') : null;
    const renewedTo = input.renewedTo ? DateOnly.parse(input.renewedTo, 'renewedTo') : null;
    if (renewedFrom && renewedTo && renewedFrom > renewedTo) {
      throw Errors.field('renewedFrom', 'El rango de fechas es inválido (desde > hasta)');
    }
    const res = await this.repos.members.list({
      today,
      warnDays: settings.renewalWarnDays,
      q: normalizeSearchQuery(input.q),
      status: input.status ?? 'ACTIVE',
      renewalStatus: input.renewalStatus && input.renewalStatus.length > 0 ? input.renewalStatus : null,
      planId: input.planId ?? null,
      renewedFrom,
      renewedTo,
      sort: input.sort ?? 'priority',
      order: input.order ?? 'asc',
      page,
    });
    return { items: res.items.map((m) => memberView(m, today, settings.renewalWarnDays)), total: res.total, ...page };
  }
}

export interface MemberSummaryView {
  registered: number;
  activeUpToDate: number;
  expired: number;
  dueToday: number;
  due3d: number;
  due7d: number;
  ok: number;
  unknown: number;
  cancelled: number;
  lastAutoCancellation: { ranAt: string; applied: number } | null;
}

/** GET /members/summary: conteos sobre todo el padrón. */
export class GetMemberSummaryUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<MemberSummaryView> {
    const settings = await loadSettings(this.repos);
    const counts = await this.repos.members.summary(this.clock.today(), settings.renewalWarnDays);
    const last = await this.repos.jobRuns.lastFinished('AUTO_CANCEL_MEMBERS', 'OK');
    const result = (last?.result ?? null) as { applied?: number } | null;
    return {
      ...counts,
      lastAutoCancellation:
        last && last.finishedAt ? { ranAt: last.finishedAt.toISOString(), applied: Number(result?.applied ?? 0) } : null,
    };
  }
}

/** GET /members/{id}: ficha (HU-SOC-08). */
export class GetMemberDetailUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(id: string): Promise<MemberDetailView> {
    const settings = await loadSettings(this.repos);
    const member = await getLiveMember(this.repos, id);
    const [memberships, lastAttendance, statusEvents] = await Promise.all([
      this.repos.memberships.listByMember(id, false),
      this.repos.attendances.lastActive(id),
      this.repos.members.listStatusEvents(id),
    ]);
    return memberDetailView(member, this.clock.today(), settings.renewalWarnDays, settings.attendanceThresholds, {
      currentMembership: pickCurrentMembership(memberships),
      lastAttendance,
      statusEvents,
    });
  }
}

/** GET /members/{id}/status-events. */
export class ListMemberStatusEventsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(id: string): Promise<MemberStatusEventView[]> {
    await getLiveMember(this.repos, id);
    return (await this.repos.members.listStatusEvents(id)).map(statusEventView);
  }
}

/** GET /members/{id}/memberships. */
export class ListMemberMembershipsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(id: string, includeVoided: boolean): Promise<MembershipView[]> {
    await getLiveMember(this.repos, id);
    return (await this.repos.memberships.listByMember(id, includeVoided)).map(membershipView);
  }
}

/** GET /members/{id}/whatsapp-link (HU-SOC-06) con las plantillas de 06-etiquetas.json. */
export class GetWhatsappLinkUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly labels: LabelCatalog,
  ) {}

  async execute(id: string, template: WhatsappTemplate): Promise<{ url: string; message: string }> {
    const member = await getLiveMember(this.repos, id);
    const text = this.labels.whatsappTemplate(template);
    if (!text) throw Errors.field('template', 'Plantilla desconocida', template);
    return buildWhatsappLink(PhoneNumber.fromStored(member.phoneRaw, member.phoneE164, member.phoneNeedsReview), member.firstName, text);
  }
}

// ───────────── Escritura ─────────────

export interface CreateMemberInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  planId: string;
  acquisitionSource?: string | null;
  notes?: string | null;
  joinedAt?: string;
  /** Quién cerró la venta; por defecto, la persona vinculada al usuario autenticado. */
  soldByStaffId?: string | null;
  initialPayment?: MembershipPaymentInput;
}

/** POST /members (HU-SOC-02): socio + pago inicial opcional en la misma transacción. */
export class CreateMemberUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly memberships: MembershipService,
  ) {}

  async execute(
    ctx: RequestContext,
    input: CreateMemberInput,
  ): Promise<{ member: MemberView; membership: MembershipView | null; warnings: string[] }> {
    requireUserId(ctx);
    const firstName = nameOrThrow(input.firstName, 'firstName', 'El nombre');
    const lastName = nameOrThrow(input.lastName, 'lastName', 'El apellido');
    const phone = PhoneNumber.parse(input.phone);
    if (!phone.raw) throw Errors.field('phone', 'El teléfono es obligatorio');
    const today = this.clock.today();
    const joinedAt = input.joinedAt
      ? DateOnly.parse(input.joinedAt, 'joinedAt')
      : input.initialPayment?.paidOn
        ? DateOnly.parse(input.initialPayment.paidOn, 'initialPayment.paidOn')
        : today;
    if (joinedAt > today) throw Errors.field('joinedAt', 'La fecha de alta no puede ser futura', joinedAt);
    const sName = searchName(firstName, lastName);

    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const existing = await tx.members.findActiveBySearchName(sName);
      if (existing) {
        throw Errors.conflict(ErrorCodes.MEMBER_NAME_EXISTS, `Ya existe un socio con ese nombre y apellido (${existing.legacyCode})`, [
          { field: 'existingLegacyCode', message: 'Código del socio existente', value: existing.legacyCode },
        ]);
      }
      const plan = await resolvePlanForMember(tx, input.planId, []);
      const soldBy = await resolveSoldByForCreate(tx, ctx, input.soldByStaffId);
      const legacyCode = formatCode('LB', await tx.sequences.next('member'), 3);
      let member = await tx.members.create({
        legacyCode,
        firstName,
        lastName,
        searchName: sName,
        phoneRaw: phone.raw,
        phoneE164: phone.e164,
        phoneNeedsReview: phone.needsReview,
        email: normalizeEmailOrNull(input.email),
        joinedAt,
        status: 'ACTIVE',
        currentPlanId: plan.id,
        acquisitionSource: cleanText(input.acquisitionSource ?? null),
        notes: cleanMultiline(input.notes ?? null),
        soldByStaffId: soldBy.id,
        createdById: ctx.actor.userId,
      });
      await tx.members.addStatusEvent({
        memberId: member.id,
        type: 'ACTIVATED',
        effectiveOn: joinedAt,
        reason: null,
        createdById: ctx.actor.userId,
      });
      await tx.audit.log(
        { entity: 'MEMBER', entityId: member.id, entityLabel: memberLabel(member), action: 'CREATE', after: memberSnapshot(member) },
        ctx,
      );
      let membershipView_: MembershipView | null = null;
      const warnings: string[] = [];
      if (input.initialPayment) {
        const res = await this.memberships.register(tx, ctx, member, input.initialPayment);
        member = res.member;
        membershipView_ = membershipView(res.membership);
        warnings.push(...res.warnings);
      }
      return { member: memberView(member, today, settings.renewalWarnDays), membership: membershipView_, warnings };
    });
  }
}

export interface UpdateMemberInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  currentPlanId?: string;
  expiresAt?: string;
  acquisitionSource?: string | null;
  notes?: string | null;
  /** Solo ADMIN (403 para otros roles). null = "Sin asignar". */
  soldByStaffId?: string | null;
}

/** PATCH /members/{id} (HU-SOC-03). Cambiar el plan no genera pago. "Vendido por" solo lo cambia ADMIN. */
export class UpdateMemberUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string, input: UpdateMemberInput): Promise<MemberView> {
    requireUserId(ctx);
    if (input.soldByStaffId !== undefined && ctx.actor.role !== 'ADMIN') {
      throw Errors.forbidden(ErrorCodes.FORBIDDEN, 'Solo un administrador puede cambiar quién cerró la venta');
    }
    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const member = await getLiveMember(tx, id);
      const patch: MemberPatch = {};
      const firstName = input.firstName !== undefined ? nameOrThrow(input.firstName, 'firstName', 'El nombre') : member.firstName;
      const lastName = input.lastName !== undefined ? nameOrThrow(input.lastName, 'lastName', 'El apellido') : member.lastName;
      if (firstName !== member.firstName) patch.firstName = firstName;
      if (lastName !== member.lastName) patch.lastName = lastName;
      const sName = searchName(firstName, lastName);
      if (sName !== member.searchName) {
        const existing = await tx.members.findActiveBySearchName(sName, id);
        if (existing) {
          throw Errors.conflict(ErrorCodes.MEMBER_NAME_EXISTS, `Ya existe un socio con ese nombre y apellido (${existing.legacyCode})`, [
            { field: 'existingLegacyCode', message: 'Código del socio existente', value: existing.legacyCode },
          ]);
        }
        patch.searchName = sName;
      }
      if (input.phone !== undefined) {
        const phone = PhoneNumber.parse(input.phone);
        patch.phoneRaw = phone.raw;
        patch.phoneE164 = phone.e164;
        patch.phoneNeedsReview = phone.needsReview;
      }
      if (input.email !== undefined) patch.email = normalizeEmailOrNull(input.email);
      if (input.currentPlanId !== undefined && input.currentPlanId !== member.currentPlanId) {
        const plan = await resolvePlanForMember(tx, input.currentPlanId, [member.currentPlanId]);
        patch.currentPlanId = plan.id;
      }
      if (input.expiresAt !== undefined) {
        const expiresAt = DateOnly.parse(input.expiresAt, 'expiresAt');
        if (member.lastRenewalAt !== null && expiresAt < member.lastRenewalAt) {
          throw Errors.field('expiresAt', 'El vencimiento no puede ser anterior a la última renovación', expiresAt);
        }
        patch.expiresAt = expiresAt;
      }
      if (input.acquisitionSource !== undefined) patch.acquisitionSource = cleanText(input.acquisitionSource);
      if (input.notes !== undefined) patch.notes = cleanMultiline(input.notes);
      if (input.soldByStaffId !== undefined && input.soldByStaffId !== member.soldByStaffId) {
        patch.soldByStaffId = input.soldByStaffId === null ? null : (await requireActiveStaff(tx, input.soldByStaffId)).id;
      }
      const today = this.clock.today();
      if (Object.keys(patch).length === 0) return memberView(member, today, settings.renewalWarnDays);
      patch.updatedById = ctx.actor.userId;
      const updated = await tx.members.update(id, patch);
      await tx.audit.log(
        { entity: 'MEMBER', entityId: id, entityLabel: memberLabel(updated), action: 'UPDATE', before: memberSnapshot(member), after: memberSnapshot(updated) },
        ctx,
      );
      return memberView(updated, today, settings.renewalWarnDays);
    });
  }
}

/** DELETE /members/{id} (HU-SOC-07): anulación lógica solo sin actividad. */
export class DeleteMemberUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<void> {
    requireUserId(ctx);
    await this.uow.run(async (tx) => {
      const member = await getLiveMember(tx, id);
      if (await tx.members.hasActivity(id)) {
        throw Errors.conflict(
          ErrorCodes.MEMBER_HAS_ACTIVITY,
          'El socio tiene pagos, movimientos o asistencias activas. Dalo de baja en lugar de anularlo.',
        );
      }
      const updated = await tx.members.update(id, { deletedAt: this.clock.now(), updatedById: ctx.actor.userId });
      await tx.audit.log(
        { entity: 'MEMBER', entityId: id, entityLabel: memberLabel(member), action: 'DELETE', before: memberSnapshot(member), after: memberSnapshot(updated) },
        ctx,
      );
    });
  }
}

/** POST /members/{id}/cancel (HU-SOC-04). */
export class CancelMemberUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string, input: { reason: string; effectiveOn?: string }): Promise<MemberView> {
    requireUserId(ctx);
    const reason = cleanText(input.reason);
    if (!reason) throw Errors.field('reason', 'Indicá el motivo de la baja');
    const today = this.clock.today();
    const effectiveOn = input.effectiveOn ? DateOnly.parse(input.effectiveOn, 'effectiveOn') : today;
    if (effectiveOn > today) throw Errors.field('effectiveOn', 'La fecha de baja no puede ser futura', effectiveOn);
    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const member = await getLiveMember(tx, id);
      if (member.status === 'CANCELLED') {
        throw Errors.conflict(ErrorCodes.MEMBER_ALREADY_CANCELLED, 'El socio ya está de baja');
      }
      if (effectiveOn < member.joinedAt) {
        throw Errors.field('effectiveOn', 'La fecha de baja no puede ser anterior al alta', effectiveOn);
      }
      await tx.members.addStatusEvent({ memberId: id, type: 'CANCELLED', effectiveOn, reason, createdById: ctx.actor.userId });
      const updated = await tx.members.update(id, {
        status: 'CANCELLED',
        cancelledAt: effectiveOn,
        cancellationReason: reason,
        updatedById: ctx.actor.userId,
      });
      await tx.audit.log(
        { entity: 'MEMBER', entityId: id, entityLabel: memberLabel(updated), action: 'CANCEL', before: memberSnapshot(member), after: memberSnapshot(updated) },
        ctx,
      );
      return memberView(updated, today, settings.renewalWarnDays);
    });
  }
}

/** POST /members/{id}/reactivate (HU-SOC-04): no toca el vencimiento ni borra el historial. */
export class ReactivateMemberUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<MemberView> {
    requireUserId(ctx);
    const today = this.clock.today();
    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const member = await getLiveMember(tx, id);
      if (member.status === 'ACTIVE') throw Errors.conflict(ErrorCodes.MEMBER_ALREADY_ACTIVE, 'El socio ya está activo');
      const lastCancel = await tx.members.lastCancellationEvent(id);
      const effectiveOn = lastCancel && lastCancel.effectiveOn > today ? lastCancel.effectiveOn : today;
      await tx.members.addStatusEvent({ memberId: id, type: 'REACTIVATED', effectiveOn, reason: null, createdById: ctx.actor.userId });
      // cancelled_at / cancellation_reason quedan con la última baja (04 §4 regla 5).
      const updated = await tx.members.update(id, { status: 'ACTIVE', updatedById: ctx.actor.userId });
      await tx.audit.log(
        { entity: 'MEMBER', entityId: id, entityLabel: memberLabel(updated), action: 'REACTIVATE', before: memberSnapshot(member), after: memberSnapshot(updated) },
        ctx,
      );
      return memberView(updated, today, settings.renewalWarnDays);
    });
  }
}

export interface AutoCancellationResult {
  applied: number;
  thresholdDays: number;
  members: { id: string; legacyCode: string; fullName: string; expiresAt: string }[];
}

/**
 * Baja automática por inactividad (HU-SOC-05). Lee `members.auto_cancel_after_days` (default 15,
 * pendiente de confirmación). La corre el cron diario (actor `system`) y el botón de ADMIN.
 * Usa lock exclusivo para que dos instancias no la apliquen a la vez y registra `job_runs`.
 */
export class RunAutoCancellationsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly jobs: JobRunner,
  ) {}

  async execute(ctx: RequestContext): Promise<AutoCancellationResult> {
    const outcome = await this.jobs.run('AUTO_CANCEL_MEMBERS', 'job:AUTO_CANCEL_MEMBERS', async (tx) => {
      const settings = await loadSettings(tx);
      const threshold = settings.autoCancelAfterDays;
      const today = this.clock.today();
      const candidates = await tx.members.findAutoCancelCandidates(autoCancelCutoff(today, threshold));
      const selected = selectAutoCancellations(candidates, today, threshold);
      const result: AutoCancellationResult = { applied: 0, thresholdDays: threshold, members: [] };
      for (const member of selected) {
        await tx.members.addStatusEvent({
          memberId: member.id,
          type: 'AUTO_CANCELLED',
          effectiveOn: today,
          reason: settings.autoCancelReason,
          createdById: ctx.actor.userId,
        });
        const updated = await tx.members.update(member.id, {
          status: 'CANCELLED',
          cancelledAt: today,
          cancellationReason: settings.autoCancelReason,
          updatedById: ctx.actor.userId,
        });
        await tx.audit.log(
          {
            entity: 'MEMBER',
            entityId: member.id,
            entityLabel: memberLabel(member),
            action: 'CANCEL',
            before: memberSnapshot(member),
            after: { ...memberSnapshot(updated), autoCancelled: true, thresholdDays: threshold },
          },
          ctx,
        );
        result.members.push({
          id: member.id,
          legacyCode: member.legacyCode,
          fullName: fullName(member.firstName, member.lastName),
          expiresAt: member.expiresAt as string,
        });
      }
      result.applied = result.members.length;
      return result;
    });
    if (!outcome.acquired) {
      throw Errors.conflict(ErrorCodes.CONFLICT, 'Las bajas automáticas se están aplicando en este momento. Probá de nuevo en unos segundos.');
    }
    return outcome.result;
  }
}
