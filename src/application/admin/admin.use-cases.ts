import { renewalStatus } from '../../domain/members/renewal-status';
import { Clock, SecretGenerator } from '../../domain/ports/ports';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { AuditLogFilter, Repositories } from '../../domain/repositories/repositories';
import { settingDefinition, SettingValueType, validateSettingValue } from '../../domain/settings/business-settings';
import { AuditAction, AuditEntity, MemberStatus, NutritionBilling, RenewalStatus } from '../../domain/shared/enums';
import { ErrorCodes, Errors, DomainError } from '../../domain/shared/errors';
import { RequestContext } from '../../domain/shared/request-context';
import { fullName, normalizeSearchQuery } from '../../domain/shared/text';
import { loadSettings, pageRequest, requireUserId } from '../common/helpers';
import { AuditLogView, auditLogView, PageView, SettingView, settingView } from '../common/views';

// ───────────── Nutrición ─────────────

export interface NutritionMemberRowView {
  id: string;
  legacyCode: string;
  fullName: string;
  status: MemberStatus;
  plan: { id: string; name: string; nutritionBilling: NutritionBilling } | null;
  planSource: 'CURRENT_MEMBERSHIP' | 'MEMBER_PLAN' | 'NONE';
  membershipStartsOn: string | null;
  membershipExpiresOn: string | null;
  renewalStatus: RenewalStatus;
}

/**
 * GET /nutrition/members (HU-NUT-01, D4): plan de la membresía vigente o, si no hay, el plan
 * actual del socio; quién cobra el honorario sale de `plans.nutrition_billing`. Sin montos.
 */
export class ListNutritionMembersUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    page?: number;
    pageSize?: number;
    q?: string;
    status?: MemberStatus;
    nutritionBilling?: NutritionBilling;
  }): Promise<PageView<NutritionMemberRowView>> {
    const settings = await loadSettings(this.repos);
    const today = this.clock.today();
    const page = pageRequest(input.page, input.pageSize);
    const res = await this.repos.members.listNutrition({
      today,
      q: normalizeSearchQuery(input.q),
      status: input.status ?? 'ACTIVE',
      nutritionBilling: input.nutritionBilling ?? null,
      page,
    });
    return {
      items: res.items.map((r) => ({
        id: r.id,
        legacyCode: r.legacyCode,
        fullName: fullName(r.firstName, r.lastName),
        status: r.status,
        plan: r.plan,
        planSource: r.planSource,
        membershipStartsOn: r.membershipStartsOn,
        membershipExpiresOn: r.membershipExpiresOn,
        renewalStatus: renewalStatus(r, today, settings.renewalWarnDays),
      })),
      total: res.total,
      ...page,
    };
  }
}

// ───────────── Auditoría ─────────────

/** GET /audit-logs (HU-AUD-01/02); con `userId` es el historial de un usuario. */
export class ListAuditLogsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(input: {
    page?: number;
    pageSize?: number;
    entity?: AuditEntity;
    entityId?: string;
    action?: AuditAction;
    userId?: string;
    from?: string;
    to?: string;
  }): Promise<PageView<AuditLogView>> {
    const page = pageRequest(input.page, input.pageSize);
    const parse = (v: string | undefined, field: string): Date | null => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw Errors.field(field, 'Fecha y hora inválidas (ISO 8601)', v);
      return d;
    };
    const filter: AuditLogFilter = {
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      action: input.action ?? null,
      userId: input.userId ?? null,
      from: parse(input.from, 'from'),
      to: parse(input.to, 'to'),
    };
    const res = await this.repos.auditLogs.list(filter, page);
    return { items: res.items.map(auditLogView), total: res.total, ...page };
  }
}

// ───────────── Parámetros ─────────────

/** GET /settings. */
export class GetSettingsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(): Promise<SettingView[]> {
    const rows = await this.repos.settings.getAll();
    return rows.sort((a, b) => a.key.localeCompare(b.key)).map(settingView);
  }
}

/**
 * PATCH /settings: valida tipos (`value_type`) y reglas de cada clave; audita un registro por clave.
 * Las claves del catálogo que falten en la tabla se crean; las desconocidas → 400.
 */
export class UpdateSettingsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly secrets: SecretGenerator,
  ) {}

  async execute(ctx: RequestContext, values: Record<string, unknown>): Promise<SettingView[]> {
    const userId = requireUserId(ctx);
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
      throw Errors.field('values', 'Indicá al menos un parámetro');
    }
    return this.uow.run(async (tx) => {
      const existing = new Map((await tx.settings.getAll()).map((s) => [s.key, s]));
      const errors: DomainError[] = [];
      const planned: { key: string; value: unknown; valueType: SettingValueType; group: string; label: string }[] = [];
      for (const [key, raw] of Object.entries(values)) {
        const row = existing.get(key);
        const def = settingDefinition(key);
        if (!row && !def) {
          errors.push(new DomainError('VALIDATION', ErrorCodes.UNKNOWN_SETTING, `Parámetro desconocido: ${key}`, [
            { field: `values.${key}`, message: 'Parámetro desconocido' },
          ]));
          continue;
        }
        const valueType = (row?.valueType ?? def!.valueType) as SettingValueType;
        try {
          const value = validateSettingValue(key, valueType, raw);
          planned.push({ key, value, valueType, group: row?.group ?? def!.group, label: row?.label ?? def!.label });
        } catch (e) {
          if (e instanceof DomainError) errors.push(e);
          else throw e;
        }
      }
      if (errors.length > 0) {
        throw Errors.validation(
          'Hay parámetros inválidos',
          errors.flatMap((e) => e.details),
        );
      }
      for (const p of planned) {
        const before = existing.get(p.key);
        if (before && JSON.stringify(before.value) === JSON.stringify(p.value)) continue;
        const saved = await tx.settings.upsert({ ...p, updatedById: userId });
        await tx.audit.log(
          {
            entity: 'SETTING',
            entityId: this.secrets.uuidFromName(`setting:${p.key}`),
            entityLabel: p.key,
            action: before ? 'UPDATE' : 'CREATE',
            before: before ? { key: p.key, value: before.value } : null,
            after: { key: p.key, value: saved.value },
          },
          ctx,
        );
      }
      return (await tx.settings.getAll()).sort((a, b) => a.key.localeCompare(b.key)).map(settingView);
    });
  }
}
