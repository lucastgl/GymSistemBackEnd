import { SplitInput, validateSplits } from '../../domain/cash/splits';
import { Clock } from '../../domain/ports/ports';
import { TransactionContext, UnitOfWork } from '../../domain/ports/unit-of-work';
import { CashMovementRecord } from '../../domain/repositories/records';
import { CashFilter, CashMovementPatch, Repositories } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { MovementOrigin, MovementType, PaymentMethod, RecordStatus } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { Period } from '../../domain/shared/period';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText, formatCode } from '../../domain/shared/text';
import { PasswordConfirmationService } from '../auth/password-confirmation';
import { cashLabel, cashSnapshot } from '../common/audit-snapshots';
import { loadSettings, pageRequest, requireUserId } from '../common/helpers';
import {
  CashMovementRowView,
  cashRowView,
  CashMovementView,
  cashMovementView,
  CashTotalsView,
  cashTotalsView,
  PageView,
} from '../common/views';

export interface CashFilterInput {
  from?: string;
  to?: string;
  type?: MovementType;
  categoryId?: string;
  method?: PaymentMethod;
  origin?: MovementOrigin;
  memberId?: string;
  q?: string;
  createdBy?: string;
  status?: RecordStatus;
}

/** Filtro de caja con defaults: sin `from`/`to` usa el mes actual; status default ACTIVE. */
export function buildCashFilter(input: CashFilterInput, today: DateOnly): CashFilter {
  const month = Period.ofDate(today);
  const from = input.from ? DateOnly.parse(input.from, 'from') : input.to ? Period.first(Period.ofDate(DateOnly.parse(input.to, 'to'))) : Period.first(month);
  const to = input.to ? DateOnly.parse(input.to, 'to') : input.from ? Period.last(Period.ofDate(from)) : Period.last(month);
  if (from > to) throw Errors.field('from', 'El rango de fechas es inválido (desde > hasta)');
  return {
    from,
    to,
    type: input.type ?? null,
    categoryId: input.categoryId ?? null,
    method: input.method ?? null,
    origin: input.origin ?? null,
    memberId: input.memberId ?? null,
    q: cleanText(input.q ?? null),
    createdBy: input.createdBy ?? null,
    status: input.status ?? 'ACTIVE',
  };
}

/**
 * GET /cash/movements (HU-CAJA-01). Pide la página y los totales al repositorio con el MISMO
 * objeto de filtro: los totales se calculan en SQL sobre el conjunto filtrado, nunca sumando la página.
 */
export class ListCashMovementsUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: CashFilterInput & { page?: number; pageSize?: number; expandSplits?: boolean },
  ): Promise<PageView<CashMovementRowView> & { totals: CashTotalsView; range: { from: string; to: string } }> {
    const filter = buildCashFilter(input, this.clock.today());
    const page = pageRequest(input.page, input.pageSize);
    const [rows, totals] = await Promise.all([
      this.repos.cash.list(filter, page, input.expandSplits ?? true),
      this.repos.cash.totals(filter),
    ]);
    return {
      items: rows.items.map(cashRowView),
      total: rows.total,
      ...page,
      totals: cashTotalsView(totals),
      range: { from: filter.from, to: filter.to },
    };
  }
}

/** GET /cash/summary: KPIs y breakdowns del período con los mismos filtros. */
export class GetCashSummaryUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(input: CashFilterInput): Promise<CashTotalsView> {
    const filter = buildCashFilter(input, this.clock.today());
    return cashTotalsView(await this.repos.cash.totals(filter));
  }
}

/** GET /cash/movements/{id}. */
export class GetCashMovementUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(id: string): Promise<CashMovementView> {
    const mv = await this.repos.cash.findById(id);
    if (!mv) throw Errors.notFound('Movimiento');
    return cashMovementView(mv);
  }
}

async function assertManualCategory(tx: Pick<TransactionContext, 'categories'>, categoryId: string, type: MovementType) {
  const category = await tx.categories.findById(categoryId);
  if (!category) throw Errors.field('categoryId', 'La categoría no existe', categoryId);
  if (category.isSystem || !category.isActive || category.type !== type) {
    throw Errors.conflict(
      ErrorCodes.CATEGORY_NOT_ALLOWED,
      category.isSystem
        ? `La categoría "${category.name}" es de sistema y no se usa en movimientos manuales`
        : !category.isActive
          ? `La categoría "${category.name}" está inactiva`
          : `La categoría "${category.name}" no corresponde a un ${type === 'INCOME' ? 'ingreso' : 'egreso'}`,
    );
  }
  return category;
}

async function assertMember(tx: Pick<TransactionContext, 'members'>, memberId: string | null | undefined): Promise<void> {
  if (!memberId) return;
  const member = await tx.members.findById(memberId);
  if (!member || member.deletedAt !== null) throw Errors.field('memberId', 'El socio no existe', memberId);
}

export interface CreateCashMovementInput {
  type: MovementType;
  occurredOn?: string;
  categoryId: string;
  subcategory?: string;
  amount: number;
  splits: SplitInput[];
  description?: string;
  memberId?: string | null;
  confirmPassword?: string;
}

/** POST /cash/movements (HU-CAJA-02/03). Un egreso exige `confirmPassword` (D5). */
export class CreateCashMovementUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly confirmation: PasswordConfirmationService,
  ) {}

  async execute(ctx: RequestContext, input: CreateCashMovementInput): Promise<CashMovementView> {
    const userId = requireUserId(ctx);
    const today = this.clock.today();
    const occurredOn = input.occurredOn ? DateOnly.parse(input.occurredOn, 'occurredOn') : today;
    if (occurredOn > today) throw Errors.field('occurredOn', 'La fecha no puede ser futura', occurredOn);
    const { splits, total } = validateSplits(input.splits, input.amount);
    const description = cleanMultiline(input.description ?? null);
    const isExpense = input.type === 'EXPENSE';
    if (isExpense && !description) throw Errors.field('description', 'La descripción es obligatoria para un egreso');
    await assertManualCategory(this.repos, input.categoryId, input.type);
    await assertMember(this.repos, input.memberId);
    const settings = await loadSettings(this.repos);
    if (isExpense) await this.confirmation.confirm(userId, input.confirmPassword, settings);

    return this.uow.run(async (tx) => {
      const legacyCode = formatCode('MV', await tx.sequences.next('movement'), 4);
      const created = await tx.cash.create({
        legacyCode,
        occurredOn,
        type: input.type,
        categoryId: input.categoryId,
        subcategory: cleanText(input.subcategory ?? null),
        amount: total.toNumber(),
        description,
        memberId: input.memberId ?? null,
        origin: 'MANUAL',
        splits: splits.map((s) => ({ method: s.method, amount: s.amount.toNumber() })),
        createdById: userId,
      });
      await tx.audit.log(
        {
          entity: 'CASH_MOVEMENT',
          entityId: created.id,
          entityLabel: cashLabel(created),
          action: 'CREATE',
          after: cashSnapshot(created),
          passwordConfirmed: isExpense,
        },
        ctx,
      );
      return cashMovementView(created);
    });
  }
}

function assertEditable(mv: CashMovementRecord, mode: 'edit' | 'void'): void {
  if (mv.origin === 'RENEWAL') {
    throw mode === 'edit'
      ? Errors.conflict(ErrorCodes.EDIT_VIA_MEMBERSHIP, 'Este movimiento es una renovación: editalo desde la renovación')
      : Errors.conflict(ErrorCodes.VOID_VIA_MEMBERSHIP, 'Este movimiento es una renovación: anulalo desde la renovación');
  }
  if (mv.status === 'VOIDED') throw Errors.conflict(ErrorCodes.RECORD_VOIDED, 'El movimiento está anulado');
}

export interface UpdateCashMovementInput {
  occurredOn?: string;
  categoryId?: string;
  subcategory?: string | null;
  amount?: number;
  splits?: SplitInput[];
  description?: string | null;
  memberId?: string | null;
  confirmPassword?: string;
}

/** PATCH /cash/movements/{id} (HU-CAJA-04). RENEWAL → 409; egreso → `confirmPassword`. */
export class UpdateCashMovementUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly confirmation: PasswordConfirmationService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: UpdateCashMovementInput): Promise<CashMovementView> {
    const userId = requireUserId(ctx);
    const current = await this.repos.cash.findById(id);
    if (!current) throw Errors.notFound('Movimiento');
    assertEditable(current, 'edit');
    const patch = await this.buildPatch(current, input);
    const isExpense = current.type === 'EXPENSE';
    if (isExpense) {
      const settings = await loadSettings(this.repos);
      await this.confirmation.confirm(userId, input.confirmPassword, settings);
    }
    return this.uow.run(async (tx) => {
      const fresh = await tx.cash.findById(id);
      if (!fresh) throw Errors.notFound('Movimiento');
      assertEditable(fresh, 'edit');
      if (Object.keys(patch).length === 0) return cashMovementView(fresh);
      patch.updatedById = userId;
      const updated = await tx.cash.update(id, patch);
      await tx.audit.log(
        {
          entity: 'CASH_MOVEMENT',
          entityId: id,
          entityLabel: cashLabel(updated),
          action: 'UPDATE',
          before: cashSnapshot(fresh),
          after: cashSnapshot(updated),
          passwordConfirmed: isExpense,
        },
        ctx,
      );
      return cashMovementView(updated);
    });
  }

  private async buildPatch(current: CashMovementRecord, input: UpdateCashMovementInput): Promise<CashMovementPatch> {
    const patch: CashMovementPatch = {};
    if (input.occurredOn !== undefined) {
      const occurredOn = DateOnly.parse(input.occurredOn, 'occurredOn');
      if (occurredOn > this.clock.today()) throw Errors.field('occurredOn', 'La fecha no puede ser futura', occurredOn);
      if (occurredOn !== current.occurredOn) patch.occurredOn = occurredOn;
    }
    if (input.categoryId !== undefined && input.categoryId !== current.category.id) {
      await assertManualCategory(this.repos, input.categoryId, current.type);
      patch.categoryId = input.categoryId;
    }
    if (input.subcategory !== undefined) patch.subcategory = cleanText(input.subcategory);
    if (input.description !== undefined) {
      const description = cleanMultiline(input.description);
      if (current.type === 'EXPENSE' && !description) {
        throw Errors.field('description', 'La descripción es obligatoria para un egreso');
      }
      patch.description = description;
    }
    if (input.memberId !== undefined) {
      await assertMember(this.repos, input.memberId);
      patch.memberId = input.memberId ?? null;
    }
    if (input.splits !== undefined) {
      const { splits, total } = validateSplits(input.splits, input.amount);
      patch.splits = splits.map((s) => ({ method: s.method, amount: s.amount.toNumber() }));
      patch.amount = total.toNumber();
    } else if (input.amount !== undefined) {
      if (current.splits.length !== 1) {
        throw Errors.field('splits', 'El movimiento tiene varios métodos de pago: indicá los montos de cada uno');
      }
      const { splits, total } = validateSplits([{ method: current.splits[0]!.method, amount: input.amount }], input.amount);
      patch.splits = splits.map((s) => ({ method: s.method, amount: s.amount.toNumber() }));
      patch.amount = total.toNumber();
    }
    return patch;
  }
}

/** POST /cash/movements/{id}/void (HU-CAJA-04). RENEWAL → 409; egreso → `confirmPassword`. */
export class VoidCashMovementUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly confirmation: PasswordConfirmationService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: { reason: string; confirmPassword?: string }): Promise<CashMovementView> {
    const userId = requireUserId(ctx);
    const reason = cleanText(input.reason);
    if (!reason || reason.length < 3) throw Errors.field('reason', 'Indicá el motivo de la anulación');
    const current = await this.repos.cash.findById(id);
    if (!current) throw Errors.notFound('Movimiento');
    assertEditable(current, 'void');
    const isExpense = current.type === 'EXPENSE';
    if (isExpense) {
      const settings = await loadSettings(this.repos);
      await this.confirmation.confirm(userId, input.confirmPassword, settings);
    }
    return this.uow.run(async (tx) => {
      const fresh = await tx.cash.findById(id);
      if (!fresh) throw Errors.notFound('Movimiento');
      assertEditable(fresh, 'void');
      const updated = await tx.cash.update(id, {
        status: 'VOIDED',
        voidedAt: this.clock.now(),
        voidedById: userId,
        voidReason: reason,
        updatedById: userId,
      });
      await tx.audit.log(
        {
          entity: 'CASH_MOVEMENT',
          entityId: id,
          entityLabel: cashLabel(updated),
          action: 'VOID',
          before: cashSnapshot(fresh),
          after: cashSnapshot(updated),
          passwordConfirmed: isExpense,
        },
        ctx,
      );
      return cashMovementView(updated);
    });
  }
}
