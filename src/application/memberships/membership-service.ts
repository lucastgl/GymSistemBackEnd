import { validateSplits, SplitInput } from '../../domain/cash/splits';
import { reactivationDate } from '../../domain/members/member-status';
import {
  deriveMemberRenewalFields,
  renewalMovementDescription,
  validateMembershipDates,
} from '../../domain/memberships/membership-rules';
import { Clock } from '../../domain/ports/ports';
import { TransactionContext } from '../../domain/ports/unit-of-work';
import { MemberRecord, MembershipRecord, PlanRecord } from '../../domain/repositories/records';
import { MemberPatch } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { Period } from '../../domain/shared/period';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, formatCode, fullName } from '../../domain/shared/text';
import {
  cashLabel,
  cashSnapshot,
  memberLabel,
  memberSnapshot,
  membershipLabel,
  membershipSnapshot,
} from '../common/audit-snapshots';

export interface MembershipPaymentInput {
  planId: string;
  paidOn: string;
  expiresOn: string;
  splits: SplitInput[];
  notes?: string | null;
}

/** Plan válido para cobrar: existe y está activo, o es el plan que el socio ya tiene (D10). */
export async function resolvePlanForMember(
  tx: Pick<TransactionContext, 'plans'>,
  planId: string,
  allowedInactivePlanIds: (string | null)[],
): Promise<PlanRecord> {
  const plan = await tx.plans.findById(planId);
  if (!plan) throw Errors.field('planId', 'El plan no existe', planId);
  if (!plan.isActive && !allowedInactivePlanIds.includes(plan.id)) {
    throw Errors.conflict(ErrorCodes.PLAN_INACTIVE, `El plan "${plan.name}" está inactivo y no se puede usar en altas nuevas`);
  }
  return plan;
}

/** Advertencia si la fecha cae en un mes con cierre definitivo (quedará como cambio posterior al cierre). */
export async function closedPeriodWarning(tx: Pick<TransactionContext, 'metrics'>, date: DateOnly): Promise<string | null> {
  const period = Period.ofDate(date);
  const current = await tx.metrics.findCurrentSnapshot(period);
  if (current && current.snapshot.stage === 'FINAL') {
    return `El mes ${period} ya tiene cierre definitivo: el cambio figurará como posterior al cierre.`;
  }
  return null;
}

/**
 * Lógica compartida por el alta de socio con pago (HU-SOC-02) y la renovación (HU-REN-01..03).
 * Siempre corre dentro de la transacción del caso de uso.
 */
export class MembershipService {
  constructor(private readonly clock: Clock) {}

  async register(
    tx: TransactionContext,
    ctx: RequestContext,
    member: MemberRecord,
    input: MembershipPaymentInput,
  ): Promise<{ membership: MembershipRecord; member: MemberRecord; warnings: string[] }> {
    const today = this.clock.today();
    const paidOn = DateOnly.parse(input.paidOn, 'paidOn');
    const expiresOn = DateOnly.parse(input.expiresOn, 'expiresOn');
    validateMembershipDates(paidOn, expiresOn, today);
    const { splits, total } = validateSplits(input.splits);
    const plan = await resolvePlanForMember(tx, input.planId, [member.currentPlanId]);
    const category = await tx.categories.findRenewalCategory();
    if (!category) throw Errors.conflict(ErrorCodes.CONFLICT, 'Falta la categoría de sistema "Renovación" (ver sql/)');

    const code = formatCode('P', await tx.sequences.next('membership'), 4);
    const memberName = fullName(member.firstName, member.lastName);
    const movement = await tx.cash.create({
      legacyCode: code,
      occurredOn: paidOn,
      type: 'INCOME',
      categoryId: category.id,
      subcategory: plan.name,
      amount: total.toNumber(),
      description: renewalMovementDescription(plan.name, memberName),
      memberId: member.id,
      origin: 'RENEWAL',
      splits: splits.map((s) => ({ method: s.method, amount: s.amount.toNumber() })),
      createdById: ctx.actor.userId,
    });
    const membership = await tx.memberships.create({
      legacyCode: code,
      memberId: member.id,
      planId: plan.id,
      planName: plan.name,
      startsOn: paidOn,
      expiresOn,
      amountTotal: total.toNumber(),
      cashMovementId: movement.id,
      notes: cleanMultiline(input.notes ?? null),
      createdById: ctx.actor.userId,
    });

    const warnings: string[] = [];
    if (member.lastRenewalAt !== null && paidOn < member.lastRenewalAt) {
      warnings.push(
        `Carga retroactiva: la fecha de pago (${paidOn}) es anterior a la última renovación registrada (${member.lastRenewalAt}). El vencimiento vigente no se modificó.`,
      );
    }
    const closed = await closedPeriodWarning(tx, paidOn);
    if (closed) warnings.push(closed);

    await tx.audit.log(
      { entity: 'MEMBERSHIP', entityId: membership.id, entityLabel: membershipLabel(membership), action: 'CREATE', after: membershipSnapshot(membership) },
      ctx,
    );
    await tx.audit.log(
      { entity: 'CASH_MOVEMENT', entityId: movement.id, entityLabel: cashLabel(movement), action: 'CREATE', after: cashSnapshot(movement) },
      ctx,
    );
    const updatedMember = await this.syncMember(tx, ctx, member, { reactivateOn: paidOn });
    return { membership, member: updatedMember, warnings };
  }

  /**
   * Recalcula vencimiento, plan y última renovación del socio desde su membresía activa más
   * reciente (04 §4 regla 4). Con `reactivateOn`, un socio de baja vuelve a ACTIVE con evento
   * REACTIVATED (HU-SOC-04: renovar a un socio de baja lo reactiva).
   */
  async syncMember(
    tx: TransactionContext,
    ctx: RequestContext,
    member: MemberRecord,
    options: { reactivateOn?: DateOnly } = {},
  ): Promise<MemberRecord> {
    const memberships = await tx.memberships.listByMember(member.id, true);
    const fields = deriveMemberRenewalFields(memberships);
    const patch: MemberPatch = {};
    if (fields.lastRenewalAt !== member.lastRenewalAt) patch.lastRenewalAt = fields.lastRenewalAt;
    if (fields.expiresAt !== member.expiresAt) patch.expiresAt = fields.expiresAt;
    if (fields.currentPlanId !== undefined && fields.currentPlanId !== member.currentPlanId) {
      patch.currentPlanId = fields.currentPlanId;
    }
    let reactivated = false;
    if (options.reactivateOn && member.status === 'CANCELLED') {
      const lastCancel = await tx.members.lastCancellationEvent(member.id);
      await tx.members.addStatusEvent({
        memberId: member.id,
        type: 'REACTIVATED',
        effectiveOn: reactivationDate(options.reactivateOn, lastCancel?.effectiveOn ?? null),
        reason: 'Reactivado por renovación',
        createdById: ctx.actor.userId,
      });
      patch.status = 'ACTIVE';
      reactivated = true;
    }
    if (Object.keys(patch).length === 0) return member;
    patch.updatedById = ctx.actor.userId;
    const updated = await tx.members.update(member.id, patch);
    await tx.audit.log(
      {
        entity: 'MEMBER',
        entityId: member.id,
        entityLabel: memberLabel(updated),
        action: reactivated ? 'REACTIVATE' : 'UPDATE',
        before: memberSnapshot(member),
        after: memberSnapshot(updated),
      },
      ctx,
    );
    return updated;
  }
}
