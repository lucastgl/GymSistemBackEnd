import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { CategoryData, PlanData, Repositories } from '../../domain/repositories/repositories';
import { MovementType, NutritionBilling } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { Money } from '../../domain/shared/money';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText } from '../../domain/shared/text';
import { categoryLabel, categorySnapshot, planLabel, planSnapshot } from '../common/audit-snapshots';
import { loadSettings, requireUserId } from '../common/helpers';
import { CashCategoryView, categoryView, PlanView, planView } from '../common/views';

export interface PlanInput {
  code?: string;
  name?: string;
  priceArs?: number;
  enrollmentFeeArs?: number;
  durationDays?: number;
  requiresAdvance?: boolean;
  advanceInstallments?: number;
  benefits?: string | null;
  nutritionBilling?: NutritionBilling;
  isActive?: boolean;
  notes?: string | null;
  sortOrder?: number;
}

function money(value: number, field: string): number {
  return Money.fromNumber(value, field).toNumber();
}

function planPatchFrom(input: PlanInput): Partial<PlanData> {
  const patch: Partial<PlanData> = {};
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase();
  if (input.name !== undefined) {
    const name = cleanText(input.name);
    if (!name) throw Errors.field('name', 'El nombre del plan es obligatorio');
    patch.name = name;
  }
  if (input.priceArs !== undefined) patch.priceArs = money(input.priceArs, 'priceArs');
  if (input.enrollmentFeeArs !== undefined) patch.enrollmentFeeArs = money(input.enrollmentFeeArs, 'enrollmentFeeArs');
  if (input.durationDays !== undefined) patch.durationDays = input.durationDays;
  if (input.requiresAdvance !== undefined) patch.requiresAdvance = input.requiresAdvance;
  if (input.advanceInstallments !== undefined) patch.advanceInstallments = input.advanceInstallments;
  if (input.benefits !== undefined) patch.benefits = cleanMultiline(input.benefits);
  if (input.nutritionBilling !== undefined) patch.nutritionBilling = input.nutritionBilling;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.notes !== undefined) patch.notes = cleanMultiline(input.notes);
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  return patch;
}

/** GET /plans. */
export class ListPlansUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(includeInactive: boolean): Promise<PlanView[]> {
    return (await this.repos.plans.list(includeInactive)).map(planView);
  }
}

/** POST /plans (ADMIN). */
export class CreatePlanUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(ctx: RequestContext, input: PlanInput): Promise<PlanView> {
    requireUserId(ctx);
    const patch = planPatchFrom(input);
    if (!patch.code) throw Errors.field('code', 'El código del plan es obligatorio');
    if (!patch.name) throw Errors.field('name', 'El nombre del plan es obligatorio');
    if (patch.priceArs === undefined) throw Errors.field('priceArs', 'El precio es obligatorio');
    const settings = await loadSettings(this.repos);
    const data: PlanData = {
      code: patch.code,
      name: patch.name,
      priceArs: patch.priceArs,
      enrollmentFeeArs: patch.enrollmentFeeArs ?? 0,
      durationDays: patch.durationDays ?? settings.defaultMembershipDays,
      requiresAdvance: patch.requiresAdvance ?? false,
      advanceInstallments: patch.advanceInstallments ?? 0,
      benefits: patch.benefits ?? null,
      nutritionBilling: patch.nutritionBilling ?? 'NUTRITIONIST',
      isActive: patch.isActive ?? true,
      notes: patch.notes ?? null,
      sortOrder: patch.sortOrder ?? 0,
    };
    return this.uow.run(async (tx) => {
      if (await tx.plans.findByCode(data.code)) throw Errors.conflict(ErrorCodes.PLAN_CODE_EXISTS, 'Ya existe un plan con ese código');
      if (await tx.plans.findByName(data.name)) throw Errors.conflict(ErrorCodes.PLAN_NAME_EXISTS, 'Ya existe un plan con ese nombre');
      const plan = await tx.plans.create(data);
      await tx.audit.log({ entity: 'PLAN', entityId: plan.id, entityLabel: planLabel(plan), action: 'CREATE', after: planSnapshot(plan) }, ctx);
      return planView(plan);
    });
  }
}

/** PATCH /plans/{id} (ADMIN). */
export class UpdatePlanUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(ctx: RequestContext, id: string, input: PlanInput): Promise<PlanView> {
    requireUserId(ctx);
    const patch = planPatchFrom(input);
    return this.uow.run(async (tx) => {
      const plan = await tx.plans.findById(id);
      if (!plan) throw Errors.notFound('Plan');
      if (patch.code && patch.code !== plan.code) {
        const other = await tx.plans.findByCode(patch.code);
        if (other && other.id !== id) throw Errors.conflict(ErrorCodes.PLAN_CODE_EXISTS, 'Ya existe un plan con ese código');
      }
      if (patch.name && patch.name !== plan.name) {
        const other = await tx.plans.findByName(patch.name);
        if (other && other.id !== id) throw Errors.conflict(ErrorCodes.PLAN_NAME_EXISTS, 'Ya existe un plan con ese nombre');
      }
      if (Object.keys(patch).length === 0) return planView(plan);
      const updated = await tx.plans.update(id, patch);
      await tx.audit.log(
        { entity: 'PLAN', entityId: id, entityLabel: planLabel(updated), action: 'UPDATE', before: planSnapshot(plan), after: planSnapshot(updated) },
        ctx,
      );
      return planView(updated);
    });
  }
}

export interface CategoryInput {
  type?: MovementType;
  name?: string;
  isActive?: boolean;
  notes?: string | null;
  sortOrder?: number;
}

/** GET /cash/categories. */
export class ListCategoriesUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(filter: { type?: MovementType; includeInactive?: boolean }): Promise<CashCategoryView[]> {
    const list = await this.repos.categories.list({ type: filter.type, includeInactive: filter.includeInactive ?? false });
    return list.map(categoryView);
  }
}

/** POST /cash/categories (ADMIN). */
export class CreateCategoryUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(ctx: RequestContext, input: CategoryInput): Promise<CashCategoryView> {
    requireUserId(ctx);
    if (!input.type) throw Errors.field('type', 'El tipo es obligatorio');
    const name = cleanText(input.name);
    if (!name) throw Errors.field('name', 'El nombre es obligatorio');
    const data: CategoryData = {
      type: input.type,
      name,
      isActive: input.isActive ?? true,
      notes: cleanMultiline(input.notes ?? null),
      sortOrder: input.sortOrder ?? 0,
    };
    return this.uow.run(async (tx) => {
      if (await tx.categories.findByTypeAndName(data.type, data.name)) {
        throw Errors.conflict(ErrorCodes.CATEGORY_EXISTS, 'Ya existe una categoría con ese nombre para ese tipo');
      }
      const created = await tx.categories.create(data);
      await tx.audit.log(
        { entity: 'CASH_CATEGORY', entityId: created.id, entityLabel: categoryLabel(created), action: 'CREATE', after: categorySnapshot(created) },
        ctx,
      );
      return categoryView(created);
    });
  }
}

/** PATCH /cash/categories/{id} (ADMIN). La categoría de sistema no se desactiva ni se renombra. */
export class UpdateCategoryUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(ctx: RequestContext, id: string, input: CategoryInput): Promise<CashCategoryView> {
    requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const cat = await tx.categories.findById(id);
      if (!cat) throw Errors.notFound('Categoría');
      const patch: Partial<CategoryData> = {};
      if (input.name !== undefined) {
        const name = cleanText(input.name);
        if (!name) throw Errors.field('name', 'El nombre es obligatorio');
        if (name !== cat.name) patch.name = name;
      }
      if (input.type !== undefined && input.type !== cat.type) patch.type = input.type;
      if (input.isActive !== undefined && input.isActive !== cat.isActive) patch.isActive = input.isActive;
      if (input.notes !== undefined) patch.notes = cleanMultiline(input.notes);
      if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

      if (cat.isSystem && (patch.isActive === false || patch.name !== undefined || patch.type !== undefined)) {
        throw Errors.conflict(ErrorCodes.SYSTEM_CATEGORY, 'La categoría de sistema no se puede desactivar, renombrar ni cambiar de tipo');
      }
      if (patch.type !== undefined && (await tx.categories.countMovements(id)) > 0) {
        throw Errors.conflict(ErrorCodes.CATEGORY_IN_USE, 'No se puede cambiar el tipo de una categoría con movimientos');
      }
      const targetType = patch.type ?? cat.type;
      const targetName = patch.name ?? cat.name;
      if (patch.type !== undefined || patch.name !== undefined) {
        const other = await tx.categories.findByTypeAndName(targetType, targetName);
        if (other && other.id !== id) {
          throw Errors.conflict(ErrorCodes.CATEGORY_EXISTS, 'Ya existe una categoría con ese nombre para ese tipo');
        }
      }
      if (Object.keys(patch).length === 0) return categoryView(cat);
      const updated = await tx.categories.update(id, patch);
      await tx.audit.log(
        {
          entity: 'CASH_CATEGORY',
          entityId: id,
          entityLabel: categoryLabel(updated),
          action: 'UPDATE',
          before: categorySnapshot(cat),
          after: categorySnapshot(updated),
        },
        ctx,
      );
      return categoryView(updated);
    });
  }
}
