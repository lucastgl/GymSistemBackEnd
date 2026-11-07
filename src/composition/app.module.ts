/* Raíz de composición: único lugar que conoce todas las capas (exento de los límites de ESLint). */
import { InjectionToken, Logger, Module, Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { GetSettingsUseCase, ListAuditLogsUseCase, ListNutritionMembersUseCase, UpdateSettingsUseCase } from '../application/admin/admin.use-cases';
import {
  CreateAttendanceUseCase,
  GetAttendanceSummaryUseCase,
  ListAttendanceRiskUseCase,
  ListAttendancesUseCase,
  ListMemberAttendancesUseCase,
  SearchMembersForCheckInUseCase,
  UpdateAttendanceUseCase,
  VoidAttendanceUseCase,
} from '../application/attendances/attendances.use-cases';
import {
  ChangePasswordUseCase,
  GetMeUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
  ResolveSessionUserUseCase,
  SessionIssuer,
} from '../application/auth/auth.use-cases';
import { PasswordConfirmationService } from '../application/auth/password-confirmation';
import {
  CreateCashMovementUseCase,
  GetCashMovementUseCase,
  GetCashSummaryUseCase,
  ListCashMovementsUseCase,
  UpdateCashMovementUseCase,
  VoidCashMovementUseCase,
} from '../application/cash/cash.use-cases';
import {
  CreateCategoryUseCase,
  CreatePlanUseCase,
  ListCategoriesUseCase,
  ListPlansUseCase,
  UpdateCategoryUseCase,
  UpdatePlanUseCase,
} from '../application/catalog/catalog.use-cases';
import { IncentivePlanner } from '../application/incentives/incentive-planner';
import {
  CloseIncentivePeriodUseCase,
  GetIncentivePeriodUseCase,
  GetIncentivePlanUseCase,
  GetIncentivesHistoryUseCase,
  PublishIncentivePeriodUseCase,
} from '../application/incentives/incentives.use-cases';
import { JobRunner } from '../application/jobs/job-runner';
import { DailyAutoCancellationJob, StartupRecoveryUseCase } from '../application/jobs/scheduled-jobs.use-cases';
import {
  CreateLeadUseCase,
  DeleteLeadUseCase,
  GetLeadsSummaryUseCase,
  ListLeadsUseCase,
  MoveLeadStageUseCase,
  UpdateLeadUseCase,
} from '../application/leads/leads.use-cases';
import {
  CancelMemberUseCase,
  CreateMemberUseCase,
  DeleteMemberUseCase,
  GetMemberDetailUseCase,
  GetMemberSummaryUseCase,
  GetWhatsappLinkUseCase,
  ListMemberMembershipsUseCase,
  ListMembersUseCase,
  ListMemberStatusEventsUseCase,
  ReactivateMemberUseCase,
  RunAutoCancellationsUseCase,
  UpdateMemberUseCase,
} from '../application/members/members.use-cases';
import { MembershipService } from '../application/memberships/membership-service';
import {
  CreateMembershipUseCase,
  GetMembershipUseCase,
  ListMembershipsUseCase,
  UpdateMembershipUseCase,
  VoidMembershipUseCase,
} from '../application/memberships/memberships.use-cases';
import {
  CloseMetricsPeriodUseCase,
  GetMetricDefinitionsUseCase,
  GetMetricsHistoryUseCase,
  GetMonthlyMetricsUseCase,
  ListMetricMonthsUseCase,
  ListMetricSnapshotsUseCase,
  MetricsReader,
  PeriodCloser,
  ReconcilePeriodClosesUseCase,
} from '../application/metrics/metrics.use-cases';
import {
  CreateStaffMemberUseCase,
  ListStaffMembersUseCase,
  ListStaffOptionsUseCase,
  UpdateStaffMemberUseCase,
} from '../application/staff/staff.use-cases';
import { ListUsersUseCase, CreateUserUseCase, GetUserUseCase, ResetUserPasswordUseCase, UpdateUserUseCase } from '../application/users/users.use-cases';
import { TOKENS } from '../domain/ports/tokens';
import { BusinessClock, FixedClock } from '../infrastructure/clock/business-clock';
import { AppConfig, loadAppConfig } from '../infrastructure/config/app-config';
import { JsonLabelCatalog } from '../infrastructure/contract/contract-files';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { createRepositories, PrismaUnitOfWork } from '../infrastructure/prisma/prisma-unit-of-work';
import { APP_CONFIG, JobScheduler } from '../infrastructure/scheduling/job-scheduler';
import {
  Argon2PasswordHasher,
  CryptoSecretGenerator,
  InMemoryAttemptLimiter,
  JwtTokenService,
} from '../infrastructure/security/security-adapters';
import { AuthController, UsersController } from '../presentation/controllers/auth-users.controller';
import { HealthController } from '../presentation/controllers/health.controller';
import { IncentivesController, StaffMembersController } from '../presentation/controllers/incentives.controller';
import {
  AuditController,
  LeadsController,
  MetricsController,
  NutritionController,
  SettingsController,
} from '../presentation/controllers/insights.controller';
import { MembersController, MembershipsController } from '../presentation/controllers/members.controller';
import {
  AttendancesController,
  CashController,
  PlansController,
} from '../presentation/controllers/operations.controller';
import { AllExceptionsFilter } from '../presentation/http/exception-filter';
import { JwtAuthGuard, MustChangePasswordGuard, RolesGuard } from '../presentation/http/guards';
import { createValidationPipe } from '../presentation/http/validation';

export const APP_LOGGER = Symbol.for('lb.AppLogger');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor = new (...args: any[]) => unknown;

/** Registra un caso de uso (clase sin decoradores de Nest) con sus dependencias explícitas. */
function useCase(cls: Ctor, inject: InjectionToken[] = []): Provider {
  return { provide: cls, useFactory: (...deps: unknown[]) => new cls(...deps), inject };
}

const R = TOKENS.Repositories;
const U = TOKENS.UnitOfWork;
const C = TOKENS.Clock;
const H = TOKENS.PasswordHasher;
const T = TOKENS.TokenService;
const S = TOKENS.SecretGenerator;
const L = TOKENS.AttemptLimiter;

const infrastructure: Provider[] = [
  { provide: APP_CONFIG, useFactory: (): AppConfig => loadAppConfig() },
  PrismaService,
  {
    provide: C,
    useFactory: (config: AppConfig) => (config.fixedNow ? new FixedClock(config.fixedNow) : new BusinessClock()),
    inject: [APP_CONFIG],
  },
  { provide: H, useValue: new Argon2PasswordHasher() },
  {
    provide: T,
    useFactory: (jwt: JwtService, config: AppConfig) =>
      new JwtTokenService(jwt, config.jwtAccessSecret, config.jwtAccessTtlSeconds, config.refreshTokenTtlDays),
    inject: [JwtService, APP_CONFIG],
  },
  { provide: S, useValue: new CryptoSecretGenerator() },
  { provide: L, useValue: new InMemoryAttemptLimiter() },
  { provide: TOKENS.LabelCatalog, useFactory: () => new JsonLabelCatalog() },
  { provide: R, useFactory: (prisma: PrismaService) => createRepositories(prisma), inject: [PrismaService] },
  { provide: U, useFactory: (prisma: PrismaService, clock: BusinessClock) => new PrismaUnitOfWork(prisma, clock), inject: [PrismaService, C] },
  { provide: APP_LOGGER, useValue: new Logger('Jobs') },
];

const applicationServices: Provider[] = [
  useCase(SessionIssuer, [T, S, C]),
  useCase(PasswordConfirmationService, [R, H, L]),
  useCase(MembershipService, [C]),
  useCase(JobRunner, [U, C, APP_LOGGER]),
  useCase(MetricsReader, [C]),
  useCase(PeriodCloser, [C, MetricsReader]),
  useCase(IncentivePlanner, [C]),
];

const useCases: Provider[] = [
  // Auth y usuarios
  useCase(LoginUseCase, [R, U, H, L, SessionIssuer, C]),
  useCase(RefreshSessionUseCase, [R, U, T, SessionIssuer, C]),
  useCase(LogoutUseCase, [R, T, C]),
  useCase(ChangePasswordUseCase, [R, U, H, L, SessionIssuer, C]),
  useCase(GetMeUseCase, [R]),
  useCase(ResolveSessionUserUseCase, [R, T]),
  useCase(ListUsersUseCase, [R]),
  useCase(GetUserUseCase, [R]),
  useCase(CreateUserUseCase, [R, U, H, S]),
  useCase(UpdateUserUseCase, [R, U, C]),
  useCase(ResetUserPasswordUseCase, [U, H, S, C]),
  // Catálogos
  useCase(ListPlansUseCase, [R]),
  useCase(CreatePlanUseCase, [R, U]),
  useCase(UpdatePlanUseCase, [U]),
  useCase(ListCategoriesUseCase, [R]),
  useCase(CreateCategoryUseCase, [U]),
  useCase(UpdateCategoryUseCase, [U]),
  // Socios
  useCase(ListMembersUseCase, [R, C]),
  useCase(GetMemberSummaryUseCase, [R, C]),
  useCase(GetMemberDetailUseCase, [R, C]),
  useCase(ListMemberStatusEventsUseCase, [R]),
  useCase(ListMemberMembershipsUseCase, [R]),
  useCase(GetWhatsappLinkUseCase, [R, TOKENS.LabelCatalog]),
  useCase(CreateMemberUseCase, [U, C, MembershipService]),
  useCase(UpdateMemberUseCase, [U, C]),
  useCase(DeleteMemberUseCase, [U, C]),
  useCase(CancelMemberUseCase, [U, C]),
  useCase(ReactivateMemberUseCase, [U, C]),
  useCase(RunAutoCancellationsUseCase, [U, C, JobRunner]),
  // Renovaciones
  useCase(CreateMembershipUseCase, [U, C, MembershipService]),
  useCase(ListMembershipsUseCase, [R]),
  useCase(GetMembershipUseCase, [R]),
  useCase(UpdateMembershipUseCase, [U, C, MembershipService]),
  useCase(VoidMembershipUseCase, [U, C, MembershipService]),
  // Asistencias
  useCase(ListAttendancesUseCase, [R]),
  useCase(ListMemberAttendancesUseCase, [R]),
  useCase(CreateAttendanceUseCase, [U, C]),
  useCase(UpdateAttendanceUseCase, [U, C]),
  useCase(VoidAttendanceUseCase, [U, C]),
  useCase(SearchMembersForCheckInUseCase, [R, C]),
  useCase(ListAttendanceRiskUseCase, [R, C]),
  useCase(GetAttendanceSummaryUseCase, [R, C]),
  // Caja
  useCase(ListCashMovementsUseCase, [R, C]),
  useCase(GetCashSummaryUseCase, [R, C]),
  useCase(GetCashMovementUseCase, [R]),
  useCase(CreateCashMovementUseCase, [R, U, C, PasswordConfirmationService]),
  useCase(UpdateCashMovementUseCase, [R, U, C, PasswordConfirmationService]),
  useCase(VoidCashMovementUseCase, [R, U, C, PasswordConfirmationService]),
  // Leads
  useCase(ListLeadsUseCase, [R, C]),
  useCase(CreateLeadUseCase, [U, C]),
  useCase(UpdateLeadUseCase, [U, C]),
  useCase(MoveLeadStageUseCase, [U]),
  useCase(DeleteLeadUseCase, [U, C]),
  useCase(GetLeadsSummaryUseCase, [R, C]),
  // Nutrición, auditoría y parámetros
  useCase(ListNutritionMembersUseCase, [R, C]),
  useCase(ListAuditLogsUseCase, [R]),
  useCase(GetSettingsUseCase, [R]),
  useCase(UpdateSettingsUseCase, [U, S]),
  // Métricas y procesos
  useCase(GetMonthlyMetricsUseCase, [R, C, MetricsReader]),
  useCase(GetMetricsHistoryUseCase, [R, C, MetricsReader]),
  useCase(ListMetricMonthsUseCase, [R, C]),
  useCase(GetMetricDefinitionsUseCase, []),
  useCase(ListMetricSnapshotsUseCase, [R]),
  useCase(CloseMetricsPeriodUseCase, [U, C, MetricsReader, PeriodCloser]),
  useCase(ReconcilePeriodClosesUseCase, [C, JobRunner, PeriodCloser]),
  // Equipo y objetivos (Fase 4)
  useCase(ListStaffMembersUseCase, [R]),
  useCase(ListStaffOptionsUseCase, [R]),
  useCase(CreateStaffMemberUseCase, [U]),
  useCase(UpdateStaffMemberUseCase, [U]),
  useCase(GetIncentivesHistoryUseCase, [R, C, IncentivePlanner]),
  useCase(GetIncentivePlanUseCase, [R, C, IncentivePlanner]),
  useCase(GetIncentivePeriodUseCase, [R, C, IncentivePlanner]),
  useCase(PublishIncentivePeriodUseCase, [U, C, IncentivePlanner]),
  useCase(CloseIncentivePeriodUseCase, [U, C, IncentivePlanner]),
  useCase(DailyAutoCancellationJob, [RunAutoCancellationsUseCase, APP_LOGGER]),
  useCase(StartupRecoveryUseCase, [R, C, RunAutoCancellationsUseCase, ReconcilePeriodClosesUseCase, APP_LOGGER]),
];

@Module({
  imports: [JwtModule.register({}), ScheduleModule.forRoot()],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    PlansController,
    MembersController,
    MembershipsController,
    AttendancesController,
    CashController,
    MetricsController,
    NutritionController,
    LeadsController,
    AuditController,
    SettingsController,
    StaffMembersController,
    IncentivesController,
  ],
  providers: [
    ...infrastructure,
    ...applicationServices,
    ...useCases,
    JobScheduler,
    // Orden de los guards globales: autenticación → cambio de contraseña pendiente → rol.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
