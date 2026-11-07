import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { loadSettings } from '../../application/common/helpers';
import { DailyAutoCancellationJob, StartupRecoveryUseCase } from '../../application/jobs/scheduled-jobs.use-cases';
import { ReconcilePeriodClosesUseCase } from '../../application/metrics/metrics.use-cases';
import { Repositories } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { TOKENS } from '../../domain/ports/tokens';
import { BusinessClock } from '../clock/business-clock';
import { AppConfig } from '../config/app-config';

export const APP_CONFIG = Symbol.for('lb.AppConfig');

/**
 * Procesos automáticos con @nestjs/schedule, siempre en la zona del negocio (`app.timezone`):
 * - Baja automática diaria a las 03:00.
 * - Cierre preliminar el último día del mes a `metrics.auto_close_time` (23:59).
 * - Cierre definitivo el día `metrics.renewal_grace_days + 1` a `metrics.final_close_time` (00:05).
 * - Recuperación al arrancar (bajas del día y cierres pendientes, que reconstruyen la historia).
 * Los horarios se leen de `settings` al arrancar; un cambio de horario requiere reiniciar.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly names: string[] = [];

  constructor(
    private readonly registry: SchedulerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TOKENS.Clock) private readonly clock: BusinessClock,
    @Inject(TOKENS.Repositories) private readonly repos: Repositories,
    private readonly autoCancel: DailyAutoCancellationJob,
    private readonly reconcile: ReconcilePeriodClosesUseCase,
    private readonly recovery: StartupRecoveryUseCase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let zone = this.clock.timeZone();
    try {
      const settings = await loadSettings(this.repos);
      zone = settings.timeZone;
      this.clock.setTimeZone(zone);
      if (!this.config.jobsEnabled) {
        this.logger.warn('JOBS_ENABLED=false: no se programan procesos automáticos ni la recuperación al arrancar.');
        return;
      }
      const [pHour, pMin] = settings.autoCloseTime.split(':');
      const [fHour, fMin] = settings.finalCloseTime.split(':');
      let finalDay = settings.renewalGraceDays + 1;
      if (finalDay > 28) {
        this.logger.warn(`metrics.renewal_grace_days + 1 = ${finalDay}: el cierre definitivo se programa el día 28.`);
        finalDay = 28;
      }
      this.add('auto-cancel', '0 0 3 * * *', zone, () => this.autoCancel.execute());
      this.add('close-preliminary', `0 ${Number(pMin)} ${Number(pHour)} 28-31 * *`, zone, async () => {
        const today = this.clock.today();
        if (DateOnly.day(DateOnly.addDays(today, 1)) !== 1) return; // solo el último día del mes
        await this.reconcile.execute('CLOSE_PERIOD_PRELIMINARY');
      });
      this.add('close-final', `0 ${Number(fMin)} ${Number(fHour)} ${finalDay} * *`, zone, () =>
        this.reconcile.execute('CLOSE_PERIOD_FINAL').then(() => undefined),
      );
      this.logger.log(
        `Procesos programados (${zone}): bajas 03:00, cierre preliminar ${settings.autoCloseTime} del último día, cierre definitivo día ${finalDay} ${settings.finalCloseTime}.`,
      );
    } catch (error) {
      this.logger.error(`No se pudieron programar los procesos: ${(error as Error).message}`);
      return;
    }
    // La recuperación corre en segundo plano para no demorar el arranque de la API.
    setImmediate(() => {
      this.recovery.execute().catch((e: Error) => this.logger.error(`Recuperación al arrancar falló: ${e.message}`, e.stack));
    });
  }

  private add(name: string, expression: string, zone: string, handler: () => Promise<unknown>): void {
    const job = CronJob.from({
      cronTime: expression,
      timeZone: zone,
      start: false,
      onTick: () => {
        handler().catch((e: Error) => this.logger.error(`Proceso ${name} falló: ${e.message}`, e.stack));
      },
    });
    this.registry.addCronJob(name, job);
    job.start();
    this.names.push(name);
  }

  onModuleDestroy(): void {
    for (const name of this.names) {
      try {
        this.registry.deleteCronJob(name);
      } catch {
        // ya eliminado
      }
    }
  }
}
