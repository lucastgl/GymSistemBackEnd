import { CloseSchedule, CloseStage, planPendingCloses, stageFor } from '../../domain/metrics/close-planning';
import {
  BREAKDOWN_PREFIXES,
  categorySlug,
  METRIC_DEFINITIONS,
  MetricDefinition,
  metricDefinition,
  TOP_LEVEL_METRIC_KEYS,
} from '../../domain/metrics/metric-definitions';
import { calculateMonthlyMetrics, MetricsParameters, MetricsResult } from '../../domain/metrics/metrics-calculator';
import { Clock } from '../../domain/ports/ports';
import { TransactionContext, UnitOfWork } from '../../domain/ports/unit-of-work';
import { MetricSnapshotRecord } from '../../domain/repositories/records';
import { Repositories } from '../../domain/repositories/repositories';
import { BusinessSettings, FIXED_COST_KEYS } from '../../domain/settings/business-settings';
import { JobName, MethodologyVersion, MetricSource, SnapshotSource } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { round1 } from '../../domain/shared/money';
import { DateOnly } from '../../domain/shared/date-only';
import { Period } from '../../domain/shared/period';
import { RequestContext, systemContext } from '../../domain/shared/request-context';
import { loadSettings, requireUserId } from '../common/helpers';
import { MetricSnapshotInfoView, snapshotInfoView } from '../common/views';
import { JobRunner } from '../jobs/job-runner';

export interface StoredMetricValue {
  value: number | null;
  methodologyVersion: MethodologyVersion;
  isProvisional: boolean;
}

export interface PeriodValues {
  period: Period;
  source: MetricSource;
  snapshot: MetricSnapshotRecord | null;
  values: Map<string, StoredMetricValue>;
}

export interface MetricValueView {
  key: string;
  value: number | null;
  methodologyVersion: MethodologyVersion;
  source: MetricSource;
  isProvisional: boolean;
  delta: { absolute: number; relativePct: number | null; lowerIsBetter: boolean } | null;
}

export interface MonthlyMetricsView {
  period: string;
  previousPeriod: string;
  isCurrentMonth: boolean;
  isClosed: boolean;
  isReconstructed: boolean;
  source: MetricSource;
  methodologyVersion: MethodologyVersion;
  cutoverPeriod: string;
  snapshot: MetricSnapshotInfoView | null;
  changesAfterClose: number;
  values: Record<string, MetricValueView>;
  previousValues: Record<string, MetricValueView>;
  breakdowns: {
    incomeByMethod: Record<string, number>;
    incomeByCategory: Record<string, number>;
    expenseByCategory: Record<string, number>;
    leadsByStage: Record<string, number>;
  };
  parameters: {
    fixedCosts: Record<string, number>;
    fixedCostsTotal: number;
    marketRent: number;
    renewalGraceDays: number;
    goals: { members: number; churnPct: number; avgTicket: number };
  };
  generatedAt: string;
}

export function metricsParameters(settings: BusinessSettings): MetricsParameters {
  return {
    renewalGraceDays: settings.renewalGraceDays,
    daysPerMonth: settings.daysPerMonth,
    fixedCosts: settings.fixedCosts,
    marketRent: settings.marketRent,
    goals: settings.goals,
  };
}

export function closeSchedule(settings: BusinessSettings): CloseSchedule {
  return {
    graceDays: settings.renewalGraceDays,
    autoCloseTime: settings.autoCloseTime,
    finalCloseTime: settings.finalCloseTime,
  };
}

/** Lectura de valores del mes: snapshot vigente (nunca REFERENCE) o cálculo en vivo con V1. */
export class MetricsReader {
  constructor(private readonly clock: Clock) {}

  async compute(repos: Pick<Repositories, 'metrics'>, period: Period, settings: BusinessSettings): Promise<MetricsResult> {
    const dataset = await repos.metrics.loadDataset(period, settings.renewalGraceDays);
    return calculateMonthlyMetrics(dataset, metricsParameters(settings), this.clock.today());
  }

  async read(repos: Pick<Repositories, 'metrics'>, period: Period, settings: BusinessSettings): Promise<PeriodValues> {
    const current = await repos.metrics.findCurrentSnapshot(period);
    if (current) {
      return {
        period,
        source: 'SNAPSHOT',
        snapshot: current.snapshot,
        values: new Map(
          current.values.map((v) => [
            v.metricKey,
            { value: v.value, methodologyVersion: v.methodologyVersion, isProvisional: v.isProvisional },
          ]),
        ),
      };
    }
    const live = await this.compute(repos, period, settings);
    return { period, source: 'LIVE', snapshot: null, values: liveValues(live) };
  }
}

function liveValues(result: MetricsResult): Map<string, StoredMetricValue> {
  return new Map(
    Object.entries(result.values).map(([k, v]) => [
      k,
      { value: v.value, methodologyVersion: 'V1' as MethodologyVersion, isProvisional: v.isProvisional },
    ]),
  );
}

function delta(def: MetricDefinition | undefined, cur: number | null, prev: number | null | undefined): MetricValueView['delta'] {
  if (cur === null || prev === null || prev === undefined) return null;
  const decimals = def?.decimals ?? 2;
  const factor = 10 ** decimals;
  return {
    absolute: Math.round((cur - prev) * factor) / factor,
    relativePct: prev === 0 ? null : round1(((cur - prev) / Math.abs(prev)) * 100),
    lowerIsBetter: def?.lowerIsBetter ?? false,
  };
}

function topLevelValues(pv: PeriodValues, previous: PeriodValues | null): Record<string, MetricValueView> {
  const out: Record<string, MetricValueView> = {};
  for (const key of TOP_LEVEL_METRIC_KEYS) {
    const v = pv.values.get(key);
    if (!v) continue;
    const def = metricDefinition(key);
    out[key] = {
      key,
      value: v.value,
      methodologyVersion: v.methodologyVersion,
      source: pv.source,
      isProvisional: v.isProvisional,
      delta: previous ? delta(def, v.value, previous.values.get(key)?.value) : null,
    };
  }
  return out;
}

function prefixed(values: Map<string, StoredMetricValue>, prefix: string, rename?: (k: string) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of values) {
    if (!k.startsWith(prefix) || v.value === null) continue;
    const sub = k.slice(prefix.length);
    out[rename ? rename(sub) : sub] = v.value;
  }
  return out;
}

/** Arma la vista del mes (HU-MET-01) a partir de los valores leídos. */
export async function buildMonthlyView(
  repos: Pick<Repositories, 'metrics' | 'categories'>,
  cur: PeriodValues,
  prev: PeriodValues,
  settings: BusinessSettings,
  today: DateOnly,
  now: Date,
): Promise<MonthlyMetricsView> {
  const categories = await repos.categories.list({ includeInactive: true });
  const nameBySlug = new Map(categories.map((c) => [categorySlug(c.name), c.name]));
  const catName = (slug: string): string => nameBySlug.get(slug) ?? slug;
  const p = (key: string, fallback: number): number => cur.values.get(`${BREAKDOWN_PREFIXES.params}${key}`)?.value ?? fallback;
  const fixedCosts: Record<string, number> = {};
  for (const k of FIXED_COST_KEYS) fixedCosts[k] = p(`fixed_costs.${k}`, settings.fixedCosts[k]);
  const goalsChurn = p('goals.churn_pct', settings.goals.churnPct);
  const snapshot = cur.snapshot;
  const changesAfterClose =
    snapshot && snapshot.stage === 'FINAL' ? await repos.metrics.countChangesAfterClose(cur.period, snapshot.closedAt) : 0;
  const versions = [...cur.values.values()].map((v) => v.methodologyVersion);
  const methodologyVersion: MethodologyVersion =
    versions.filter((v) => v === 'LEGACY_V3_7').length > versions.length / 2 ? 'LEGACY_V3_7' : 'V1';
  return {
    period: cur.period,
    previousPeriod: prev.period,
    isCurrentMonth: cur.period === Period.ofDate(today),
    isClosed: snapshot !== null,
    isReconstructed: cur.period < settings.cutoverPeriod,
    source: cur.source,
    methodologyVersion,
    cutoverPeriod: settings.cutoverPeriod,
    snapshot: snapshot ? snapshotInfoView(snapshot) : null,
    changesAfterClose,
    values: topLevelValues(cur, prev),
    previousValues: topLevelValues(prev, null),
    breakdowns: {
      incomeByMethod: prefixed(cur.values, BREAKDOWN_PREFIXES.incomeByMethod),
      incomeByCategory: prefixed(cur.values, BREAKDOWN_PREFIXES.incomeByCategory, catName),
      expenseByCategory: prefixed(cur.values, BREAKDOWN_PREFIXES.expenseByCategory, catName),
      leadsByStage: prefixed(cur.values, BREAKDOWN_PREFIXES.leadsByStage),
    },
    parameters: {
      fixedCosts,
      fixedCostsTotal: Object.values(fixedCosts).reduce((a, b) => a + b, 0),
      marketRent: p('market_rent', settings.marketRent),
      renewalGraceDays: p('renewal_grace_days', settings.renewalGraceDays),
      goals: {
        members: p('goals.active_members', settings.goals.activeMembers),
        // En % (0-100), igual que churn_pct y como lo siembra sql/03a (goals.churn_pct = 18).
        churnPct: goalsChurn,
        avgTicket: p('goals.avg_ticket', settings.goals.avgTicket),
      },
    },
    generatedAt: now.toISOString(),
  };
}

/** GET /metrics/monthly. */
export class GetMonthlyMetricsUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
    private readonly reader: MetricsReader,
  ) {}

  async execute(periodInput?: string): Promise<MonthlyMetricsView> {
    const settings = await loadSettings(this.repos);
    const today = this.clock.today();
    const currentMonth = Period.ofDate(today);
    const period = periodInput ? Period.parse(periodInput) : currentMonth;
    if (period > currentMonth) throw Errors.field('period', 'El período es futuro', period);
    const [cur, prev] = await Promise.all([
      this.reader.read(this.repos, period, settings),
      this.reader.read(this.repos, Period.previous(period), settings),
    ]);
    return buildMonthlyView(this.repos, cur, prev, settings, today, this.clock.now());
  }
}

/** GET /metrics/history: series mensuales; los snapshots REFERENCE nunca participan. */
export class GetMetricsHistoryUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
    private readonly reader: MetricsReader,
  ) {}

  async execute(input: { from?: string; to?: string; keys?: string[] }): Promise<{
    from: string;
    to: string;
    cutoverPeriod: string;
    series: {
      key: string;
      points: {
        period: string;
        value: number | null;
        methodologyVersion: MethodologyVersion;
        source: MetricSource;
        isProvisional: boolean;
        isReconstructed: boolean;
      }[];
    }[];
  }> {
    const settings = await loadSettings(this.repos);
    const currentMonth = Period.ofDate(this.clock.today());
    const first = (await this.repos.metrics.firstDataPeriod()) ?? currentMonth;
    const from = input.from ? Period.parse(input.from, 'from') : first;
    let to = input.to ? Period.parse(input.to, 'to') : currentMonth;
    if (to > currentMonth) to = currentMonth;
    if (from > to) throw Errors.field('from', 'El rango de períodos es inválido (desde > hasta)');
    const keys = input.keys && input.keys.length > 0 ? input.keys : [...TOP_LEVEL_METRIC_KEYS];
    const periods = Period.range(from, to);
    const perPeriod: PeriodValues[] = [];
    for (const p of periods) perPeriod.push(await this.reader.read(this.repos, p, settings));
    return {
      from,
      to,
      cutoverPeriod: settings.cutoverPeriod,
      series: keys.map((key) => ({
        key,
        points: perPeriod.map((pv) => {
          const v = pv.values.get(key);
          return {
            period: pv.period,
            value: v?.value ?? null,
            methodologyVersion: v?.methodologyVersion ?? 'V1',
            source: pv.source,
            isProvisional: v?.isProvisional ?? false,
            isReconstructed: pv.period < settings.cutoverPeriod,
          };
        }),
      })),
    };
  }
}

export interface PeriodInfoView {
  period: string;
  isCurrentMonth: boolean;
  isClosed: boolean;
  closeStage: 'PRELIMINARY' | 'FINAL' | null;
  isReconstructed: boolean;
  methodologyVersion: MethodologyVersion;
  closedAt: string | null;
  closedBy: string | null;
  hasLegacySnapshot: boolean;
}

/** GET /metrics/months: del mes actual hacia atrás hasta el primer mes con datos o snapshot. */
export class ListMetricMonthsUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<{ cutoverPeriod: string; periods: PeriodInfoView[] }> {
    const settings = await loadSettings(this.repos);
    const currentMonth = Period.ofDate(this.clock.today());
    const snapshots = await this.repos.metrics.listSnapshots(null);
    const firstData = await this.repos.metrics.firstDataPeriod();
    let first = firstData ?? currentMonth;
    for (const s of snapshots) if (Period.isValid(s.period) && s.period < first) first = s.period;
    if (first > currentMonth) first = currentMonth;
    const periods = Period.range(first, currentMonth).reverse();
    return {
      cutoverPeriod: settings.cutoverPeriod,
      periods: periods.map((period) => {
        const current = snapshots.find((s) => s.period === period && s.isCurrent && s.stage !== 'REFERENCE') ?? null;
        return {
          period,
          isCurrentMonth: period === currentMonth,
          isClosed: current !== null,
          closeStage: current ? (current.stage as 'PRELIMINARY' | 'FINAL') : null,
          isReconstructed: period < settings.cutoverPeriod,
          methodologyVersion: 'V1',
          closedAt: current ? current.closedAt.toISOString() : null,
          closedBy: current ? current.closedByName : null,
          hasLegacySnapshot: snapshots.some((s) => s.period === period && s.stage === 'REFERENCE'),
        };
      }),
    };
  }
}

/** GET /metrics/definitions. */
export class GetMetricDefinitionsUseCase {
  execute(): MetricDefinition[] {
    return METRIC_DEFINITIONS.map((d) => ({ ...d, variables: [...d.variables] }));
  }
}

/** GET /metrics/snapshots: historial de cierres (vigentes, reemplazados y fotos REFERENCE). */
export class ListMetricSnapshotsUseCase {
  constructor(private readonly repos: Repositories) {}

  async execute(period?: string): Promise<MetricSnapshotInfoView[]> {
    const p = period ? Period.parse(period) : null;
    return (await this.repos.metrics.listSnapshots(p)).map(snapshotInfoView);
  }
}

/** Guarda un cierre: reemplaza el vigente (queda como historial) y audita CLOSE_PERIOD. */
export class PeriodCloser {
  constructor(
    private readonly clock: Clock,
    private readonly reader: MetricsReader,
  ) {}

  async close(
    tx: TransactionContext,
    ctx: RequestContext,
    period: Period,
    stage: CloseStage,
    source: SnapshotSource,
    notes: string | null,
  ): Promise<{ snapshot: MetricSnapshotRecord; result: MetricsResult; replaced: MetricSnapshotRecord | null }> {
    const settings = await loadSettings(tx);
    const existing = await tx.metrics.findCurrentSnapshot(period);
    const result = await this.reader.compute(tx, period, settings);
    const now = this.clock.now();
    if (existing) await tx.metrics.supersede(existing.snapshot.id, now);
    const snapshot = await tx.metrics.createSnapshot({
      period,
      closedAt: now,
      closedByUserId: ctx.actor.userId,
      closedByName: ctx.actor.label,
      source,
      stage,
      notes,
      values: Object.entries(result.values).map(([metricKey, v]) => ({
        metricKey,
        value: v.value,
        methodologyVersion: 'V1',
        isProvisional: v.isProvisional,
      })),
    });
    await tx.audit.log(
      {
        entity: 'METRIC_SNAPSHOT',
        entityId: snapshot.id,
        entityLabel: `${period} · ${stage === 'FINAL' ? 'Cierre definitivo' : 'Cierre preliminar'}`,
        action: 'CLOSE_PERIOD',
        before: existing ? { snapshotId: existing.snapshot.id, stage: existing.snapshot.stage, closedAt: existing.snapshot.closedAt } : null,
        after: { period, stage, source, isReconstructed: period < settings.cutoverPeriod, notes },
      },
      ctx,
    );
    return { snapshot, result, replaced: existing?.snapshot ?? null };
  }
}

export const METRICS_CLOSE_LOCK = 'metrics:close';

/**
 * POST /metrics/close (ADMIN): recalcula un mes ya terminado. Con cierre vigente exige `replace`.
 * Por la decisión D1 todos los meses son V1, así que LEGACY_PERIOD_FROZEN no se usa.
 */
export class CloseMetricsPeriodUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly reader: MetricsReader,
    private readonly closer: PeriodCloser,
  ) {}

  async execute(
    ctx: RequestContext,
    input: { period: string; replace?: boolean; notes?: string },
  ): Promise<{ snapshot: MetricSnapshotInfoView; metrics: MonthlyMetricsView; warnings: string[] }> {
    requireUserId(ctx);
    const period = Period.parse(input.period);
    const today = this.clock.today();
    if (period >= Period.ofDate(today)) {
      throw Errors.conflict(ErrorCodes.PERIOD_IN_FUTURE, 'Solo se puede recalcular un mes ya terminado');
    }
    const outcome = await this.uow.runExclusive(
      METRICS_CLOSE_LOCK,
      async (tx) => {
        const settings = await loadSettings(tx);
        const existing = await tx.metrics.findCurrentSnapshot(period);
        if (existing && !input.replace) {
          throw Errors.conflict(ErrorCodes.PERIOD_ALREADY_CLOSED, 'El mes ya tiene un cierre vigente. Confirmá el recálculo con replace = true.');
        }
        const stage = stageFor(period, today, this.clock.timeOfDay(), closeSchedule(settings));
        const { snapshot } = await this.closer.close(tx, ctx, period, stage, 'MANUAL', input.notes?.trim() || null);
        const cur = await this.reader.read(tx, period, settings);
        const prev = await this.reader.read(tx, Period.previous(period), settings);
        const metrics = await buildMonthlyView(tx, cur, prev, settings, today, this.clock.now());
        const warnings: string[] = [];
        if (stage === 'PRELIMINARY') {
          warnings.push(
            `La ventana de gracia de ${settings.renewalGraceDays} días todavía no venció: vencimientos sin renovar y churn quedan provisionales y el cierre es preliminar.`,
          );
        }
        return { snapshot: snapshotInfoView(snapshot), metrics, warnings };
      },
      { timeoutMs: 120_000 },
    );
    if (!outcome.acquired) {
      throw Errors.conflict(ErrorCodes.CLOSE_IN_PROGRESS, 'Hay un cierre de mes en curso. Probá de nuevo en unos segundos.');
    }
    return outcome.result;
  }
}

/**
 * Cierres automáticos (03 §0 regla 5): preliminar el último día 23:59, definitivo el día gracia + 1
 * a las 00:05 y recuperación al arrancar (reconstrucción de §6b desde abril 2026). Siempre a nombre
 * de `system`, con lock exclusivo y registro en `job_runs`.
 */
export class ReconcilePeriodClosesUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly jobs: JobRunner,
    private readonly closer: PeriodCloser,
  ) {}

  async execute(job: JobName): Promise<{ closed: { period: string; stage: CloseStage; replaced: boolean }[]; skipped?: boolean }> {
    const outcome = await this.jobs.run(job, METRICS_CLOSE_LOCK, async (tx) => {
      const settings = await loadSettings(tx);
      const firstPeriod = await tx.metrics.firstDataPeriod();
      if (!firstPeriod) return { closed: [] };
      const plan = planPendingCloses({
        firstPeriod,
        today: this.clock.today(),
        timeHHmm: this.clock.timeOfDay(),
        schedule: closeSchedule(settings),
        currentStages: await tx.metrics.currentStages(),
      });
      const closed: { period: string; stage: CloseStage; replaced: boolean }[] = [];
      for (const item of plan) {
        await this.closer.close(tx, systemContext(), item.period, item.stage, 'AUTO', null);
        closed.push({ period: item.period, stage: item.stage, replaced: item.replaces });
      }
      return { closed };
    });
    return outcome.acquired ? outcome.result : { closed: [], skipped: true };
  }
}
