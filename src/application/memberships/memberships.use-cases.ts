import { SplitInput, validateSplits } from '../../domain/cash/splits';
import { renewalMovementDescription, validateMembershipDates } from '../../domain/memberships/membership-rules';
import { Clock } from '../../domain/ports/ports';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { CashMovementPatch, MembershipFilter, MembershipPatch, Repositories } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { PaymentMethod, RecordStatus } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText, fullName } from '../../domain/shared/text';
import { cashLabel, cashSnapshot, membershipLabel, membershipSnapshot } from '../common/audit-snapshots';
import { loadSettings, pageRequest, requireUserId } from '../common/helpers';
import { MemberView, memberView, MembershipView, membershipView, PageView } from '../common/views';
import { MembershipPaymentInput, MembershipService, resolvePlanForMember } from './membership-service';

/** POST /members/{id}/memberships (HU-REN-01). */
export class CreateMembershipUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly service: MembershipService,
  ) {}

  async execute(
    ctx: RequestContext,
    memberId: string,
    input: MembershipPaymentInput,
  ): Promise<{ membership: MembershipView; member: MemberView; warnings: string[] }> {
    requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const member = await tx.members.findById(memberId);
      if (!member || member.deletedAt !== null) throw Errors.notFound('Socio');
      const res = await this.service.register(tx, ctx, member, input);
      return {
        membership: membershipView(res.membership),
        member: memberView(res.member, this.clock.today(), settings.renewalWarnDays),
        warnings: res.warnings,
      };
    });
  }
}

export interface ListMembershipsInput {
  page?: number;
  pageSize?: number;
  memberId?: string;
  from?: string;
  to?: string;
  planId?: string;
  method?: PaymentMethod;
  status?: RecordStatus;
}

/** GET /memberships (HU-REN-04): totales en SQL sobre el mismo filtro. */
export class ListMembershipsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(
    input: ListMembershipsInput,
  ): Promise<PageView<MembershipView> & { totals: { count: number; amountTotal: number; avgTicket: number | null } }> {
    const page = pageRequest(input.page, input.pageSize);
    const filter: MembershipFilter = {
      memberId: input.memberId ?? null,
      from: input.from ? DateOnly.parse(input.from, 'from') : null,
      to: input.to ? DateOnly.parse(input.to, 'to') : null,
      planId: input.planId ?? null,
      method: input.method ?? null,
      status: input.status ?? 'ACTIVE',
    };
    if (filter.from && filter.to && filter.from > filter.to) throw Errors.field('from', 'El rango de fechas es inválido (desde > hasta)');
    const [res, totals] = await Promise.all([this.repos.memberships.list(filter, page), this.repos.memberships.totals(filter)]);
    return {
      items: res.items.map(membershipView),
      total: res.total,
      ...page,
      totals: {
        count: totals.count,
        amountTotal: totals.amountTotal,
        avgTicket: totals.count === 0 ? null : Math.round(totals.amountTotal / totals.count),
      },
    };
  }
}

/** GET /memberships/{id}. */
export class GetMembershipUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(id: string): Promise<MembershipView> {
    const m = await this.repos.memberships.findById(id);
    if (!m) throw Errors.notFound('Renovación');
    return membershipView(m);
  }
}

export interface UpdateMembershipInput {
  planId?: string;
  paidOn?: string;
  expiresOn?: string;
  splits?: SplitInput[];
  notes?: string | null;
}

/**
 * PATCH /memberships/{id} (HU-REN-02): recalcula el movimiento de caja asociado y, si cambia la
 * vigente, el vencimiento, plan y última renovación del socio.
 */
export class UpdateMembershipUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly service: MembershipService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: UpdateMembershipInput): Promise<MembershipView> {
    requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const current = await tx.memberships.findById(id);
      if (!current) throw Errors.notFound('Renovación');
      if (current.status === 'VOIDED') throw Errors.conflict(ErrorCodes.RECORD_VOIDED, 'La renovación está anulada');
      const member = await tx.members.findById(current.memberId);
      if (!member) throw Errors.notFound('Socio');
      const movement = await tx.cash.findById(current.cashMovementId);
      if (!movement) throw Errors.notFound('Movimiento de caja');

      const paidOn = input.paidOn !== undefined ? DateOnly.parse(input.paidOn, 'paidOn') : current.startsOn;
      const expiresOn = input.expiresOn !== undefined ? DateOnly.parse(input.expiresOn, 'expiresOn') : current.expiresOn;
      if (input.paidOn !== undefined || input.expiresOn !== undefined) {
        validateMembershipDates(paidOn, expiresOn, this.clock.today());
      }
      let planId = current.planId;
      let planName = current.planName;
      if (input.planId !== undefined && input.planId !== current.planId) {
        const plan = await resolvePlanForMember(tx, input.planId, [current.planId, member.currentPlanId]);
        planId = plan.id;
        planName = plan.name;
      }
      const mPatch: MembershipPatch = {};
      const cPatch: CashMovementPatch = {};
      if (planId !== current.planId) {
        mPatch.planId = planId;
        mPatch.planName = planName;
        cPatch.subcategory = planName;
        cPatch.description = renewalMovementDescription(planName, fullName(member.firstName, member.lastName));
      }
      if (paidOn !== current.startsOn) {
        mPatch.startsOn = paidOn;
        cPatch.occurredOn = paidOn;
      }
      if (expiresOn !== current.expiresOn) mPatch.expiresOn = expiresOn;
      if (input.splits !== undefined) {
        const { splits, total } = validateSplits(input.splits);
        mPatch.amountTotal = total.toNumber();
        cPatch.amount = total.toNumber();
        cPatch.splits = splits.map((s) => ({ method: s.method, amount: s.amount.toNumber() }));
      }
      if (input.notes !== undefined) mPatch.notes = cleanMultiline(input.notes);
      if (Object.keys(mPatch).length === 0 && Object.keys(cPatch).length === 0) return membershipView(current);

      if (Object.keys(cPatch).length > 0) {
        cPatch.updatedById = ctx.actor.userId;
        const updatedMovement = await tx.cash.update(movement.id, cPatch);
        await tx.audit.log(
          {
            entity: 'CASH_MOVEMENT',
            entityId: movement.id,
            entityLabel: cashLabel(updatedMovement),
            action: 'UPDATE',
            before: cashSnapshot(movement),
            after: cashSnapshot(updatedMovement),
          },
          ctx,
        );
      }
      mPatch.updatedById = ctx.actor.userId;
      const updated = await tx.memberships.update(id, mPatch);
      await tx.audit.log(
        {
          entity: 'MEMBERSHIP',
          entityId: id,
          entityLabel: membershipLabel(updated),
          action: 'UPDATE',
          before: membershipSnapshot(current),
          after: membershipSnapshot(updated),
        },
        ctx,
      );
      await this.service.syncMember(tx, ctx, member);
      return membershipView(updated);
    });
  }
}

/**
 * POST /memberships/{id}/void (HU-REN-03): anula membresía y movimiento; el socio vuelve a su
 * membresía anterior no anulada (si no hay, vencimiento y última renovación quedan nulos).
 */
export class VoidMembershipUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly service: MembershipService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: { reason: string }): Promise<MembershipView> {
    requireUserId(ctx);
    const reason = cleanText(input.reason);
    if (!reason || reason.length < 3) throw Errors.field('reason', 'Indicá el motivo de la anulación');
    return this.uow.run(async (tx) => {
      const current = await tx.memberships.findById(id);
      if (!current) throw Errors.notFound('Renovación');
      if (current.status === 'VOIDED') throw Errors.conflict(ErrorCodes.RECORD_VOIDED, 'La renovación ya está anulada');
      const now = this.clock.now();
      const movement = await tx.cash.findById(current.cashMovementId);
      if (movement && movement.status === 'ACTIVE') {
        const voidedMovement = await tx.cash.update(movement.id, {
          status: 'VOIDED',
          voidedAt: now,
          voidedById: ctx.actor.userId,
          voidReason: reason,
          updatedById: ctx.actor.userId,
        });
        await tx.audit.log(
          {
            entity: 'CASH_MOVEMENT',
            entityId: movement.id,
            entityLabel: cashLabel(voidedMovement),
            action: 'VOID',
            before: cashSnapshot(movement),
            after: cashSnapshot(voidedMovement),
          },
          ctx,
        );
      }
      const voided = await tx.memberships.update(id, {
        status: 'VOIDED',
        voidedAt: now,
        voidedById: ctx.actor.userId,
        voidReason: reason,
        updatedById: ctx.actor.userId,
      });
      await tx.audit.log(
        {
          entity: 'MEMBERSHIP',
          entityId: id,
          entityLabel: membershipLabel(voided),
          action: 'VOID',
          before: membershipSnapshot(current),
          after: membershipSnapshot(voided),
        },
        ctx,
      );
      const member = await tx.members.findById(current.memberId);
      if (member) await this.service.syncMember(tx, ctx, member);
      return membershipView(voided);
    });
  }
}
