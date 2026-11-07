import { CashCategory, Plan, Prisma } from '@prisma/client';
import { CategoryRecord, PlanRecord, SettingRecord } from '../../../domain/repositories/records';
import {
  CategoryData,
  CategoryRepository,
  PlanData,
  PlanRepository,
  SettingsRepository,
} from '../../../domain/repositories/repositories';
import { MovementType, NutritionBilling } from '../../../domain/shared/enums';
import { Db, num, refOf, userRefs } from '../support';

function toPlan(p: Plan): PlanRecord {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    priceArs: num(p.priceArs),
    enrollmentFeeArs: num(p.enrollmentFeeArs),
    durationDays: p.durationDays,
    requiresAdvance: p.requiresAdvance,
    advanceInstallments: p.advanceInstallments,
    benefits: p.benefits,
    nutritionBilling: p.nutritionBilling as NutritionBilling,
    isActive: p.isActive,
    notes: p.notes,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toCategory(c: CashCategory): CategoryRecord {
  return {
    id: c.id,
    type: c.type as MovementType,
    name: c.name,
    isActive: c.isActive,
    isSystem: c.isSystem,
    notes: c.notes,
    sortOrder: c.sortOrder,
  };
}

export class PrismaPlanRepository implements PlanRepository {
  constructor(private readonly db: Db) {}

  async list(includeInactive: boolean): Promise<PlanRecord[]> {
    const rows = await this.db.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toPlan);
  }

  async findById(id: string): Promise<PlanRecord | null> {
    const p = await this.db.plan.findUnique({ where: { id } });
    return p ? toPlan(p) : null;
  }

  async findByCode(code: string): Promise<PlanRecord | null> {
    const p = await this.db.plan.findUnique({ where: { code } });
    return p ? toPlan(p) : null;
  }

  async findByName(name: string): Promise<PlanRecord | null> {
    const p = await this.db.plan.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    return p ? toPlan(p) : null;
  }

  async create(data: PlanData): Promise<PlanRecord> {
    return toPlan(await this.db.plan.create({ data }));
  }

  async update(id: string, patch: Partial<PlanData>): Promise<PlanRecord> {
    return toPlan(await this.db.plan.update({ where: { id }, data: patch }));
  }
}

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly db: Db) {}

  async list(filter: { type?: MovementType; includeInactive: boolean }): Promise<CategoryRecord[]> {
    const rows = await this.db.cashCategory.findMany({
      where: {
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toCategory);
  }

  async findById(id: string): Promise<CategoryRecord | null> {
    const c = await this.db.cashCategory.findUnique({ where: { id } });
    return c ? toCategory(c) : null;
  }

  async findByTypeAndName(type: MovementType, name: string): Promise<CategoryRecord | null> {
    const c = await this.db.cashCategory.findFirst({ where: { type, name: { equals: name, mode: 'insensitive' } } });
    return c ? toCategory(c) : null;
  }

  async findRenewalCategory(): Promise<CategoryRecord | null> {
    const c = await this.db.cashCategory.findFirst({
      where: { type: 'INCOME', isSystem: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return c ? toCategory(c) : null;
  }

  async create(data: CategoryData): Promise<CategoryRecord> {
    return toCategory(await this.db.cashCategory.create({ data: { ...data, isSystem: false } }));
  }

  async update(id: string, patch: Partial<CategoryData>): Promise<CategoryRecord> {
    return toCategory(await this.db.cashCategory.update({ where: { id }, data: patch }));
  }

  async countMovements(id: string): Promise<number> {
    return this.db.cashMovement.count({ where: { categoryId: id } });
  }
}

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Db) {}

  async getAll(): Promise<SettingRecord[]> {
    const rows = await this.db.setting.findMany({ orderBy: { key: 'asc' } });
    const users = await userRefs(this.db, rows.map((r) => r.updatedById));
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      valueType: r.valueType,
      group: r.group,
      label: r.label,
      description: r.description,
      updatedAt: r.updatedAt,
      updatedBy: refOf(users, r.updatedById),
    }));
  }

  async upsert(data: {
    key: string;
    value: unknown;
    valueType: string;
    group: string;
    label: string;
    updatedById: string | null;
  }): Promise<SettingRecord> {
    const value = data.value as Prisma.InputJsonValue;
    const r = await this.db.setting.upsert({
      where: { key: data.key },
      create: { key: data.key, value, valueType: data.valueType, group: data.group, label: data.label, updatedById: data.updatedById },
      update: { value, updatedById: data.updatedById },
    });
    const users = await userRefs(this.db, [r.updatedById]);
    return {
      key: r.key,
      value: r.value,
      valueType: r.valueType,
      group: r.group,
      label: r.label,
      description: r.description,
      updatedAt: r.updatedAt,
      updatedBy: refOf(users, r.updatedById),
    };
  }
}
