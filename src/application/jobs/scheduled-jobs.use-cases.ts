import { Clock } from '../../domain/ports/ports';
import { Repositories } from '../../domain/repositories/repositories';
import { systemContext } from '../../domain/shared/request-context';
import { RunAutoCancellationsUseCase } from '../members/members.use-cases';
import { ReconcilePeriodClosesUseCase } from '../metrics/metrics.use-cases';
import { AppLogger, silentLogger } from './job-runner';

/** Cron diario de bajas automáticas (03:00 BA), a nombre de `system`. */
export class DailyAutoCancellationJob {
  constructor(
    private readonly autoCancel: RunAutoCancellationsUseCase,
    private readonly logger: AppLogger = silentLogger,
  ) {}

  async execute(): Promise<void> {
    const res = await this.autoCancel.execute(systemContext());
    this.logger.log(`Bajas automáticas: ${res.applied} socio(s) con más de ${res.thresholdDays} días vencidos.`);
  }
}

/**
 * Recuperación al arrancar (03 §0 regla 5 y §6b):
 * 1. Si la baja automática no corrió hoy, la corre.
 * 2. Cierra todo mes pendiente desde el primer mes con datos (abril 2026) hasta el anterior al
 *    actual: FINAL si ya pasó la gracia, PRELIMINARY si no. Es la reconstrucción de la historia.
 */
export class StartupRecoveryUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
    private readonly autoCancel: RunAutoCancellationsUseCase,
    private readonly reconcile: ReconcilePeriodClosesUseCase,
    private readonly logger: AppLogger = silentLogger,
  ) {}

  async execute(): Promise<{ autoCancelApplied: number | null; closed: { period: string; stage: string }[] }> {
    let autoCancelApplied: number | null = null;
    const last = await this.repos.jobRuns.lastFinished('AUTO_CANCEL_MEMBERS', 'OK');
    const ranToday = last?.finishedAt ? this.clock.businessDateOf(last.finishedAt) >= this.clock.today() : false;
    if (!ranToday) {
      const res = await this.autoCancel.execute(systemContext());
      autoCancelApplied = res.applied;
      this.logger.log(`Recuperación: bajas automáticas aplicadas = ${res.applied}.`);
    }
    const closes = await this.reconcile.execute('CLOSE_PERIOD_CATCHUP');
    if (closes.closed.length > 0) {
      this.logger.log(`Recuperación: cierres guardados ${closes.closed.map((c) => `${c.period} ${c.stage}`).join(', ')}.`);
    } else {
      this.logger.log('Recuperación: no hay cierres de mes pendientes.');
    }
    return { autoCancelApplied, closed: closes.closed };
  }
}
