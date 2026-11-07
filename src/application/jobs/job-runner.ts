import { Clock } from '../../domain/ports/ports';
import { ExclusiveResult, TransactionContext, UnitOfWork } from '../../domain/ports/unit-of-work';
import { JobName } from '../../domain/shared/enums';

/** Logger mínimo que la aplicación necesita (lo provee la raíz de composición). */
export interface AppLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, trace?: string): void;
}

export const silentLogger: AppLogger = { log: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * Corre un proceso automático en una transacción con lock exclusivo (`pg_try_advisory_xact_lock`)
 * y lo registra en `job_runs` (04 §3.10). Si otra instancia tiene el lock, no hace nada.
 * Si falla, la transacción se revierte y se registra una fila ERROR aparte.
 */
export class JobRunner {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: AppLogger = silentLogger,
  ) {}

  async run<T>(job: JobName, lockKey: string, work: (tx: TransactionContext) => Promise<T>): Promise<ExclusiveResult<T>> {
    try {
      const outcome = await this.uow.runExclusive(
        lockKey,
        async (tx) => {
          const runId = await tx.jobRuns.start(job, this.clock.now());
          const result = await work(tx);
          await tx.jobRuns.finish(runId, 'OK', this.clock.now(), result, null);
          return result;
        },
        { timeoutMs: 180_000 },
      );
      if (!outcome.acquired) this.logger.warn(`${job}: otra instancia está ejecutando el proceso; se omite.`);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${job} falló: ${message}`, error instanceof Error ? error.stack : undefined);
      try {
        await this.uow.run(async (tx) => {
          const id = await tx.jobRuns.start(job, this.clock.now());
          await tx.jobRuns.finish(id, 'ERROR', this.clock.now(), null, message.slice(0, 2000));
        });
      } catch {
        // Si ni siquiera se puede registrar el error, se propaga el original.
      }
      throw error;
    }
  }
}
