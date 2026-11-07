import { IncentiveOverrides, IncentivePlan, IncentiveProgress, OVERRIDE_KEYS } from '../../domain/incentives/incentive-plan';
import { Clock } from '../../domain/ports/ports';
import { UnitOfWork } from '../../domain/ports/unit-of-work';
import { IncentivePeriodRecord, StaffRef, UserRef } from '../../domain/repositories/records';
import { Repositories } from '../../domain/repositories/repositories';
import { BusinessSettings } from '../../domain/settings/business-settings';
import { DateOnly } from '../../domain/shared/date-only';
import { IncentivePeriodStatus } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { Period } from '../../domain/shared/period';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline } from '../../domain/shared/text';
import { incentivePeriodLabel, incentivePeriodSnapshot } from '../common/audit-snapshots';
import { loadSettings, requireUserId } from '../common/helpers';
import { IncentiveData, IncentivePlanner, IncentiveRepos, staffRef } from './incentive-planner';

/** Repositorios de lectura que usan los casos de uso GET. */
export type IncentiveReadRepos = IncentiveRepos & Pick<Repositories, 'settings'>;

/** Objetivos y bonos del equipo (HU-OBJ-01..05, docs/03 §8). Todo es solo ADMIN. */

/** Rango máximo del histórico, para que una consulta no recorra años enteros. */
const MAX_HISTORY_MONTHS = 36;

// ───────────── Vistas (docs/05) ─────────────

export interface IncentiveMonthView {
  period: string;
  isBeforeHistoryStart: boolean;
  attributionApproximate: boolean;
  newMembers: number;
  newMembersAmount: number;
  newMembersByStaff: { staff: StaffRef; count: number }[];
  newMembersUnassigned: number;
  renewalPayments: number;
  renewalPaymentsAmount: number;
  expirations: number | null;
  renewed: number | null;
  renewalRatePct: number | null;
  renewalIsFinal: boolean;
  otherIncome: number;
  expenses: number;
  expensesComplete: boolean;
  margin: number;
  incentive: {
    status: IncentivePeriodStatus;
    newMembersTarget: number;
    renewalRateTargetPct: number;
    renewalsTarget: number;
    newMembersAchieved: boolean | null;
    renewalsAchieved: boolean | null;
    totalBonusesArs: number | null;
  } | null;
}

export interface IncentivesHistoryView {
  from: string;
  to: string;
  cutoverPeriod: string;
  months: IncentiveMonthView[];
}

export interface IncentivePeriodDetailView {
  period: string;
  status: IncentivePeriodStatus;
  plan: IncentivePlan;
  progress: IncentiveProgress | null;
  canPublish: boolean;
  canClose: boolean;
  closableFrom: string | null;
  notes: string | null;
  publishedAt: string | null;
  publishedBy: UserRef | null;
  closedAt: string | null;
  closedBy: UserRef | null;
}

export type IncentivePlanQuery = IncentiveOverrides & { period?: string };

export interface PublishIncentivePeriodInput {
  overrides?: IncentiveOverrides;
  notes?: string | null;
  replace?: boolean;
  acceptNegativeResult?: boolean;
}

export interface CloseIncentivePeriodInput {
  notes?: string | null;
  replace?: boolean;
}

// ───────────── Helpers ─────────────

function pickOverrides(source: IncentiveOverrides | undefined): IncentiveOverrides {
  const out: IncentiveOverrides = {};
  if (!source) return out;
  for (const k of OVERRIDE_KEYS) {
    const v = source[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/**
 * IncentivePeriodDetail: sin publicar → propuesta en vivo (DRAFT); publicado → plan congelado y
 * avance en vivo; cerrado → plan y resultado congelados.
 */
async function buildDetail(
  planner: IncentivePlanner,
  repos: IncentiveRepos,
  period: Period,
  settings: BusinessSettings,
  today: DateOnly,
  record: IncentivePeriodRecord | null,
  prepared?: { plan: IncentivePlan; data: IncentiveData },
): Promise<IncentivePeriodDetailView> {
  const current = Period.ofDate(today);
  let status: IncentivePeriodStatus;
  let plan: IncentivePlan;
  let data: IncentiveData;
  let progress: IncentiveProgress | null;
  if (!record) {
    const built = prepared ?? (await planner.buildPlan(repos, period, {}, settings));
    status = 'DRAFT';
    plan = built.plan;
    data = built.data;
    progress = period <= current ? await planner.buildProgress(repos, period, plan, data, false) : null;
  } else {
    status = record.status;
    plan = record.plan as IncentivePlan;
    data = prepared?.data ?? (await planner.loadPeriod(repos, period, settings));
    progress =
      record.status === 'CLOSED'
        ? (record.results as IncentiveProgress)
        : period <= current
          ? await planner.buildProgress(repos, period, plan, data, false)
          : null;
  }
  const closable = planner.closableFrom(period, data);
  return {
    period,
    status,
    plan,
    progress,
    canPublish: period === current && status !== 'CLOSED',
    canClose: status !== 'DRAFT' && today >= closable,
    closableFrom: closable,
    notes: record?.notes ?? null,
    publishedAt: record ? record.publishedAt.toISOString() : null,
    publishedBy: record?.publishedBy ?? null,
    closedAt: record?.closedAt ? record.closedAt.toISOString() : null,
    closedBy: record?.closedBy ?? null,
  };
}

// ───────────── Lectura ─────────────

/** GET /incentives/history (HU-OBJ-05): en vivo, sin cierres de métricas. */
export class GetIncentivesHistoryUseCase {
  constructor(
    private readonly repos: IncentiveReadRepos,
    private readonly clock: Clock,
    private readonly planner: IncentivePlanner,
  ) {}

  async execute(input: { from?: string; to?: string }): Promise<IncentivesHistoryView> {
    const settings = await loadSettings(this.repos);
    const inc = settings.incentives;
    const today = this.clock.today();
    const from = input.from ? Period.parse(input.from, 'from') : inc.historyStartPeriod;
    const to = input.to ? Period.parse(input.to, 'to') : Period.ofDate(today);
    if (from > to) throw Errors.field('from', 'El rango de meses es inválido (desde > hasta)', from);
    if (Period.range(from, to).length > MAX_HISTORY_MONTHS) {
      throw Errors.field('from', `El histórico admite hasta ${MAX_HISTORY_MONTHS} meses por consulta`, from);
    }
    const [data, staff, published] = await Promise.all([
      this.planner.loadData(this.repos, from, to, settings),
      this.repos.staff.list(true),
      this.repos.incentives.listPeriods(from, to),
    ]);
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const orderOf = (id: string): number => staffById.get(id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const recordByPeriod = new Map(published.map((r) => [r.period, r]));
    const months: IncentiveMonthView[] = [];
    for (const m of data.months.values()) {
      const assigned = m.raw.newMembersByStaff.filter((r): r is typeof r & { staffId: string } => r.staffId !== null);
      const record = recordByPeriod.get(m.period) ?? null;
      months.push({
        period: m.period,
        isBeforeHistoryStart: m.period < inc.historyStartPeriod,
        attributionApproximate: m.period < settings.cutoverPeriod,
        newMembers: m.facts.newMembers,
        newMembersAmount: m.facts.newMembersAmount,
        newMembersByStaff: assigned
          .map((r) => ({ staff: staffRef(staffById.get(r.staffId) ?? { id: r.staffId, displayName: '—' }), count: r.count }))
          .sort((a, b) => orderOf(a.staff.id) - orderOf(b.staff.id) || a.staff.displayName.localeCompare(b.staff.displayName, 'es')),
        newMembersUnassigned: m.raw.newMembersByStaff.filter((r) => r.staffId === null).reduce((a, r) => a + r.count, 0),
        renewalPayments: m.facts.renewalPayments,
        renewalPaymentsAmount: m.facts.renewalPaymentsAmount,
        expirations: m.facts.expirations,
        renewed: m.facts.renewed,
        renewalRatePct: m.renewals.hasData ? m.renewals.ratePct : null,
        renewalIsFinal: m.renewals.isFinal,
        otherIncome: m.facts.otherIncome,
        expenses: m.expensesTotal,
        expensesComplete: m.facts.expensesComplete,
        margin: Math.round((m.incomeTotal - m.expensesTotal) * 100) / 100,
        incentive: record ? incentiveSummary(record) : null,
      });
    }
    return { from, to, cutoverPeriod: settings.cutoverPeriod, months };
  }
}

/**
 * Resumen del objetivo publicado en el histórico (definición del coordinador): logros y total de
 * bonos solo si el mes está cerrado (salen de `results`); con el mes publicado, null.
 */
function incentiveSummary(record: IncentivePeriodRecord): NonNullable<IncentiveMonthView['incentive']> {
  const r = record.status === 'CLOSED' ? (record.results as IncentiveProgress) : null;
  return {
    status: record.status,
    newMembersTarget: record.newMembersTarget,
    renewalRateTargetPct: record.renewalRateTargetPct,
    renewalsTarget: record.renewalsTarget,
    newMembersAchieved: r ? r.newMembers.achieved : null,
    renewalsAchieved: r ? r.renewals.achieved : null,
    totalBonusesArs: r ? r.totals.totalArs : null,
  };
}

/** GET /incentives/plan (HU-OBJ-01): simulador. Calcula todo en el backend y no guarda nada. */
export class GetIncentivePlanUseCase {
  constructor(
    private readonly repos: IncentiveReadRepos,
    private readonly clock: Clock,
    private readonly planner: IncentivePlanner,
  ) {}

  async execute(input: IncentivePlanQuery): Promise<IncentivePlan> {
    const settings = await loadSettings(this.repos);
    const period = input.period ? Period.parse(input.period, 'period') : Period.ofDate(this.clock.today());
    const { plan } = await this.planner.buildPlan(this.repos, period, pickOverrides(input), settings);
    return plan;
  }
}

/** GET /incentives/periods/{period} (HU-OBJ-03): siempre 200. */
export class GetIncentivePeriodUseCase {
  constructor(
    private readonly repos: IncentiveReadRepos,
    private readonly clock: Clock,
    private readonly planner: IncentivePlanner,
  ) {}

  async execute(periodParam: string): Promise<IncentivePeriodDetailView> {
    const period = Period.parse(periodParam, 'period');
    const settings = await loadSettings(this.repos);
    const record = await this.repos.incentives.findPeriod(period);
    return buildDetail(this.planner, this.repos, period, settings, this.clock.today(), record);
  }
}

// ───────────── Escritura ─────────────

/**
 * POST /incentives/periods/{period}/publish (HU-OBJ-02): congela objetivo, montos, insumos y la
 * lista de elegibles. Solo el mes en curso; `replace` para republicar mientras no esté cerrado;
 * resultado negativo después de bonos exige `acceptNegativeResult`. Audita PUBLISH.
 */
export class PublishIncentivePeriodUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly planner: IncentivePlanner,
  ) {}

  async execute(ctx: RequestContext, periodParam: string, input: PublishIncentivePeriodInput): Promise<IncentivePeriodDetailView> {
    const userId = requireUserId(ctx);
    const period = Period.parse(periodParam, 'period');
    const today = this.clock.today();
    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const existing = await tx.incentives.findPeriod(period);
      if (existing?.status === 'CLOSED') {
        throw Errors.conflict(ErrorCodes.INCENTIVE_PERIOD_CLOSED, `${incentivePeriodLabel(period)} ya está cerrado: no se puede volver a publicar`);
      }
      if (period !== Period.ofDate(today)) {
        throw Errors.conflict(ErrorCodes.INCENTIVE_PERIOD_NOT_EDITABLE, 'Solo se puede publicar el objetivo del mes en curso');
      }
      if (existing && input.replace !== true) {
        throw Errors.conflict(
          ErrorCodes.INCENTIVE_ALREADY_PUBLISHED,
          'El objetivo de este mes ya está publicado. Para cambiarlo, confirmá que querés volver a publicarlo.',
        );
      }
      const built = await this.planner.buildPlan(tx, period, pickOverrides(input.overrides), settings);
      const result = built.plan.projection.resultAfterBonuses;
      const negative = result !== null && result < 0;
      if (negative && input.acceptNegativeResult !== true) {
        throw Errors.conflict(
          ErrorCodes.INCENTIVE_RESULT_NEGATIVE,
          'Con este objetivo el mes cerraría en negativo después de pagar los bonos. Confirmalo para publicar igual.',
          [{ field: 'acceptNegativeResult', message: 'Resultado proyectado después de bonos', value: result }],
        );
      }
      const plan: IncentivePlan = { ...built.plan, acceptedNegativeResult: negative };
      const saved = await tx.incentives.savePublished({
        period,
        formulaVersion: plan.formulaVersion,
        newMembersTarget: plan.targets.newMembers,
        renewalRateTargetPct: plan.targets.renewalRateTargetPct,
        expectedExpirations: plan.inputs.expectedExpirations,
        renewalsTarget: plan.targets.renewals,
        bonusPerNewMemberArs: plan.amounts.bonusPerNewMemberArs,
        teamBonusPerPersonArs: plan.amounts.teamBonusPerPersonArs,
        expenseReferenceArs: plan.inputs.expenseReferenceArs,
        plan,
        notes: cleanMultiline(input.notes ?? null),
        publishedAt: this.clock.now(),
        publishedById: userId,
      });
      await tx.audit.log(
        {
          entity: 'INCENTIVE_PERIOD',
          entityId: saved.id,
          entityLabel: incentivePeriodLabel(period),
          action: 'PUBLISH',
          before: existing ? incentivePeriodSnapshot(existing) : null,
          after: {
            ...incentivePeriodSnapshot(saved),
            eligibleStaff: plan.inputs.eligibleStaff,
            overrides: plan.overrides,
            acceptedNegativeResult: plan.acceptedNegativeResult,
            replaced: existing !== null,
          },
        },
        ctx,
      );
      return buildDetail(this.planner, tx, period, settings, today, saved, { plan, data: built.data });
    });
  }
}

/**
 * POST /incentives/periods/{period}/close (HU-OBJ-04): liquida con el plan congelado y guarda el
 * resultado. Desde `closableFrom`; `replace` recalcula un cierre existente. Audita CLOSE_PERIOD.
 */
export class CloseIncentivePeriodUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly planner: IncentivePlanner,
  ) {}

  async execute(ctx: RequestContext, periodParam: string, input: CloseIncentivePeriodInput): Promise<IncentivePeriodDetailView> {
    const userId = requireUserId(ctx);
    const period = Period.parse(periodParam, 'period');
    const today = this.clock.today();
    return this.uow.run(async (tx) => {
      const settings = await loadSettings(tx);
      const existing = await tx.incentives.findPeriod(period);
      if (!existing) {
        throw Errors.conflict(ErrorCodes.INCENTIVE_NOT_PUBLISHED, 'El objetivo de este mes no se publicó: no hay nada para liquidar');
      }
      if (existing.status === 'CLOSED' && input.replace !== true) {
        throw Errors.conflict(
          ErrorCodes.INCENTIVE_PERIOD_CLOSED,
          `${incentivePeriodLabel(period)} ya está cerrado. Para recalcularlo, confirmá que querés reemplazar el cierre.`,
        );
      }
      const data = await this.planner.loadPeriod(tx, period, settings);
      const closable = this.planner.closableFrom(period, data);
      if (today < closable) {
        throw Errors.conflict(
          ErrorCodes.INCENTIVE_GRACE_PENDING,
          `Todavía corre la gracia de las renovaciones del mes: se puede cerrar desde el ${closable.slice(8, 10)}/${closable.slice(5, 7)}/${closable.slice(0, 4)}`,
          [{ field: 'closableFrom', message: 'Primer día en que se puede cerrar', value: closable }],
        );
      }
      const plan = existing.plan as IncentivePlan;
      const results = await this.planner.buildProgress(tx, period, plan, data, true);
      const closeNotes = cleanMultiline(input.notes ?? null);
      const notes = closeNotes ? [existing.notes, `Cierre: ${closeNotes}`].filter(Boolean).join('\n') : existing.notes;
      const saved = await tx.incentives.saveClosed(period, { results, closedAt: this.clock.now(), closedById: userId, notes });
      await tx.audit.log(
        {
          entity: 'INCENTIVE_PERIOD',
          entityId: saved.id,
          entityLabel: incentivePeriodLabel(period),
          action: 'CLOSE_PERIOD',
          before: incentivePeriodSnapshot(existing),
          after: { ...incentivePeriodSnapshot(saved), staff: results.staff, replaced: existing.status === 'CLOSED' },
        },
        ctx,
      );
      return buildDetail(this.planner, tx, period, settings, today, saved, { plan, data });
    });
  }
}

