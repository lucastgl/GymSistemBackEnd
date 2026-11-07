import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  GetSettingsUseCase,
  ListAuditLogsUseCase,
  ListNutritionMembersUseCase,
  NutritionMemberRowView,
  UpdateSettingsUseCase,
} from '../../application/admin/admin.use-cases';
import { AuditLogView, LeadView, MetricSnapshotInfoView, PageView, SettingView } from '../../application/common/views';
import {
  CreateLeadUseCase,
  DeleteLeadUseCase,
  GetLeadsSummaryUseCase,
  LeadsBoardView,
  ListLeadsUseCase,
  MoveLeadStageUseCase,
  UpdateLeadUseCase,
} from '../../application/leads/leads.use-cases';
import {
  CloseMetricsPeriodUseCase,
  GetMetricDefinitionsUseCase,
  GetMetricsHistoryUseCase,
  GetMonthlyMetricsUseCase,
  ListMetricMonthsUseCase,
  ListMetricSnapshotsUseCase,
  MonthlyMetricsView,
} from '../../application/metrics/metrics.use-cases';
import { MetricDefinition } from '../../domain/metrics/metric-definitions';
import { RequestContext } from '../../domain/shared/request-context';
import {
  CloseMetricsPeriodDto,
  LeadInputDto,
  ListAuditLogsQueryDto,
  ListLeadsQueryDto,
  MetricsHistoryQueryDto,
  MoveLeadStageDto,
  NutritionMembersQueryDto,
  SnapshotsQueryDto,
  UpdateSettingsDto,
} from '../dto/cash-metrics.dto';
import { PeriodQueryDto } from '../dto/common.dto';
import { Ctx, Roles } from '../http/http-context';
import { uuidPipe } from './auth-users.controller';

@Controller('metrics')
@Roles('ADMIN')
export class MetricsController {
  constructor(
    private readonly months: ListMetricMonthsUseCase,
    private readonly monthly: GetMonthlyMetricsUseCase,
    private readonly history: GetMetricsHistoryUseCase,
    private readonly definitions: GetMetricDefinitionsUseCase,
    private readonly snapshots: ListMetricSnapshotsUseCase,
    private readonly close: CloseMetricsPeriodUseCase,
  ) {}

  @Get('months')
  listMonths(): ReturnType<ListMetricMonthsUseCase['execute']> {
    return this.months.execute();
  }

  @Get('monthly')
  getMonthly(@Query() q: PeriodQueryDto): Promise<MonthlyMetricsView> {
    return this.monthly.execute(q.period);
  }

  @Get('history')
  getHistory(@Query() q: MetricsHistoryQueryDto): ReturnType<GetMetricsHistoryUseCase['execute']> {
    return this.history.execute(q);
  }

  @Get('definitions')
  getDefinitions(): MetricDefinition[] {
    return this.definitions.execute();
  }

  @Get('snapshots')
  listSnapshots(@Query() q: SnapshotsQueryDto): Promise<MetricSnapshotInfoView[]> {
    return this.snapshots.execute(q.period);
  }

  @Post('close')
  closePeriod(@Body() body: CloseMetricsPeriodDto, @Ctx() ctx: RequestContext): ReturnType<CloseMetricsPeriodUseCase['execute']> {
    return this.close.execute(ctx, body);
  }
}

@Controller('nutrition')
@Roles('NUTRICIONISTA', 'ADMIN')
export class NutritionController {
  constructor(private readonly listMembers: ListNutritionMembersUseCase) {}

  @Get('members')
  members(@Query() q: NutritionMembersQueryDto): Promise<PageView<NutritionMemberRowView>> {
    return this.listMembers.execute(q);
  }
}

@Controller('leads')
@Roles('ADMIN', 'RECEPCIONISTA')
export class LeadsController {
  constructor(
    private readonly listLeads: ListLeadsUseCase,
    private readonly createLead: CreateLeadUseCase,
    private readonly summaryUc: GetLeadsSummaryUseCase,
    private readonly updateLead: UpdateLeadUseCase,
    private readonly deleteLead: DeleteLeadUseCase,
    private readonly moveStage: MoveLeadStageUseCase,
  ) {}

  @Get()
  list(@Query() q: ListLeadsQueryDto): Promise<LeadsBoardView> {
    return this.listLeads.execute(q);
  }

  @Post()
  create(@Body() body: LeadInputDto, @Ctx() ctx: RequestContext): Promise<LeadView> {
    return this.createLead.execute(ctx, body);
  }

  @Get('summary')
  summary(@Query() q: PeriodQueryDto): ReturnType<GetLeadsSummaryUseCase['execute']> {
    return this.summaryUc.execute(q.period);
  }

  @Patch(':id')
  update(@Param('id', uuidPipe) id: string, @Body() body: LeadInputDto, @Ctx() ctx: RequestContext): Promise<LeadView> {
    return this.updateLead.execute(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', uuidPipe) id: string, @Ctx() ctx: RequestContext): Promise<void> {
    await this.deleteLead.execute(ctx, id);
  }

  @Post(':id/stage')
  @HttpCode(200)
  stage(@Param('id', uuidPipe) id: string, @Body() body: MoveLeadStageDto, @Ctx() ctx: RequestContext): Promise<LeadView> {
    return this.moveStage.execute(ctx, id, body);
  }
}

@Controller('audit-logs')
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly listLogs: ListAuditLogsUseCase) {}

  @Get()
  list(@Query() q: ListAuditLogsQueryDto): Promise<PageView<AuditLogView>> {
    return this.listLogs.execute(q);
  }
}

@Controller('settings')
@Roles('ADMIN')
export class SettingsController {
  constructor(
    private readonly getSettings: GetSettingsUseCase,
    private readonly updateSettings: UpdateSettingsUseCase,
  ) {}

  @Get()
  list(): Promise<SettingView[]> {
    return this.getSettings.execute();
  }

  @Patch()
  update(@Body() body: UpdateSettingsDto, @Ctx() ctx: RequestContext): Promise<SettingView[]> {
    return this.updateSettings.execute(ctx, body.values);
  }
}
