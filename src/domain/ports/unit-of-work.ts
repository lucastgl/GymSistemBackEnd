import { AuditEntryInput, buildAuditRecord } from '../audit/audit-entry';
import { AuditLogRepository, Repositories } from '../repositories/repositories';
import { RequestContext } from '../shared/request-context';
import { Clock } from './ports';

/** Registra auditoría dentro de la transacción de la operación (04 §4 regla 6). */
export interface AuditLogger {
  log(entry: AuditEntryInput, ctx: RequestContext): Promise<void>;
}

/**
 * Implementación del puerto sobre un AuditLogRepository transaccional: sanea before/after
 * (sin hashes, tokens ni contraseñas) y calcula changedFields. Si la inserción falla,
 * el error se propaga y la transacción entera se revierte.
 */
export class RepositoryAuditLogger implements AuditLogger {
  constructor(
    private readonly repo: AuditLogRepository,
    private readonly clock: Clock,
  ) {}

  async log(entry: AuditEntryInput, ctx: RequestContext): Promise<void> {
    await this.repo.insert(buildAuditRecord(entry, ctx, this.clock.now()));
  }
}

/** Repositorios de una transacción + el puerto de auditoría. */
export interface TransactionContext extends Repositories {
  audit: AuditLogger;
}

export interface UnitOfWorkOptions {
  /** Tiempo máximo de la transacción interactiva. */
  timeoutMs?: number;
}

export type ExclusiveResult<T> = { acquired: true; result: T } | { acquired: false };

export interface UnitOfWork {
  /** Ejecuta `work` en una transacción; si lanza, se revierte todo (incluida la auditoría). */
  run<T>(work: (tx: TransactionContext) => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
  /**
   * Igual que `run` pero toma antes un lock exclusivo por `lockKey` (pg_try_advisory_xact_lock):
   * si otra instancia lo tiene, no ejecuta y devuelve `{ acquired: false }`.
   */
  runExclusive<T>(
    lockKey: string,
    work: (tx: TransactionContext) => Promise<T>,
    options?: UnitOfWorkOptions,
  ): Promise<ExclusiveResult<T>>;
}
