import { Prisma } from '@prisma/client';
import { Clock } from '../../domain/ports/ports';
import {
  ExclusiveResult,
  RepositoryAuditLogger,
  TransactionContext,
  UnitOfWork,
  UnitOfWorkOptions,
} from '../../domain/ports/unit-of-work';
import { Repositories } from '../../domain/repositories/repositories';
import { PrismaService } from './prisma.service';
import { PrismaAttendanceRepository } from './repositories/attendance.repository';
import { PrismaCashMovementRepository } from './repositories/cash.repository';
import { PrismaCategoryRepository, PrismaPlanRepository, PrismaSettingsRepository } from './repositories/catalog.repositories';
import { PrismaIncentivesRepository } from './repositories/incentives.repository';
import { PrismaLeadRepository } from './repositories/lead.repository';
import { PrismaMemberRepository } from './repositories/member.repository';
import { PrismaMembershipRepository } from './repositories/membership.repository';
import { PrismaMetricsRepository } from './repositories/metrics.repository';
import { PrismaRefreshTokenRepository, PrismaUserRepository } from './repositories/security.repositories';
import { PrismaStaffMemberRepository } from './repositories/staff.repository';
import { PrismaAuditLogRepository, PrismaJobRunRepository, PrismaSequenceRepository } from './repositories/system.repositories';
import { Db } from './support';

/** Construye los repositorios ligados a un cliente (base o transaccional). */
export function createRepositories(db: Db): Repositories {
  return {
    users: new PrismaUserRepository(db),
    refreshTokens: new PrismaRefreshTokenRepository(db),
    plans: new PrismaPlanRepository(db),
    categories: new PrismaCategoryRepository(db),
    members: new PrismaMemberRepository(db),
    memberships: new PrismaMembershipRepository(db),
    cash: new PrismaCashMovementRepository(db),
    attendances: new PrismaAttendanceRepository(db),
    leads: new PrismaLeadRepository(db),
    settings: new PrismaSettingsRepository(db),
    metrics: new PrismaMetricsRepository(db),
    staff: new PrismaStaffMemberRepository(db),
    incentives: new PrismaIncentivesRepository(db),
    auditLogs: new PrismaAuditLogRepository(db),
    jobRuns: new PrismaJobRunRepository(db),
    sequences: new PrismaSequenceRepository(db),
  };
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Hash estable de 32 bits para `pg_try_advisory_xact_lock(int, int)`. */
function lockKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return h;
}

/** Espacio de locks de esta app (primer argumento del advisory lock). */
const LOCK_NAMESPACE = 0x4c42; // "LB"

/**
 * UnitOfWork sobre `$transaction` interactiva de Prisma. Los locks son de transacción
 * (`pg_try_advisory_xact_lock`): se liberan solos al commit/rollback y funcionan con el pooler
 * de Supabase en modo transacción (un lock de sesión no sería confiable con PgBouncer).
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private context(tx: Prisma.TransactionClient): TransactionContext {
    const repos = createRepositories(tx);
    return { ...repos, audit: new RepositoryAuditLogger(repos.auditLogs, this.clock) };
  }

  run<T>(work: (tx: TransactionContext) => Promise<T>, options?: UnitOfWorkOptions): Promise<T> {
    return this.prisma.$transaction((tx) => work(this.context(tx)), {
      timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxWait: 10_000,
    });
  }

  async runExclusive<T>(
    key: string,
    work: (tx: TransactionContext) => Promise<T>,
    options?: UnitOfWorkOptions,
  ): Promise<ExclusiveResult<T>> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${lockKey(key)}::int) AS locked`;
        if (!rows[0]?.locked) return { acquired: false } as const;
        return { acquired: true, result: await work(this.context(tx)) } as const;
      },
      { timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxWait: 10_000 },
    );
  }
}
