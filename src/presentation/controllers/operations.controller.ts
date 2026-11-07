import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AttendanceRiskRowView,
  CheckInSuggestionView,
  CreateAttendanceUseCase,
  GetAttendanceSummaryUseCase,
  ListAttendanceRiskUseCase,
  ListAttendancesUseCase,
  SearchMembersForCheckInUseCase,
  UpdateAttendanceUseCase,
  VoidAttendanceUseCase,
} from '../../application/attendances/attendances.use-cases';
import {
  CreateCashMovementUseCase,
  GetCashMovementUseCase,
  GetCashSummaryUseCase,
  ListCashMovementsUseCase,
  UpdateCashMovementUseCase,
  VoidCashMovementUseCase,
} from '../../application/cash/cash.use-cases';
import {
  CreateCategoryUseCase,
  CreatePlanUseCase,
  ListCategoriesUseCase,
  ListPlansUseCase,
  UpdateCategoryUseCase,
  UpdatePlanUseCase,
} from '../../application/catalog/catalog.use-cases';
import {
  AttendanceView,
  CashCategoryView,
  CashMovementView,
  CashTotalsView,
  PageView,
  PlanView,
} from '../../application/common/views';
import { RequestContext } from '../../domain/shared/request-context';
import {
  CashCategoryInputDto,
  ListCategoriesQueryDto,
  ListPlansQueryDto,
  PlanInputDto,
} from '../dto/catalog.dto';
import {
  CashFilterQueryDto,
  CashVoidDto,
  CreateCashMovementDto,
  ListCashMovementsQueryDto,
  UpdateCashMovementDto,
} from '../dto/cash-metrics.dto';
import {
  AttendanceRiskQueryDto,
  CreateAttendanceDto,
  ListAttendancesQueryDto,
  SearchMembersQueryDto,
  UpdateAttendanceDto,
  VoidDto,
} from '../dto/members.dto';
import { Ctx, Roles } from '../http/http-context';
import { uuidPipe } from './auth-users.controller';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly listPlans: ListPlansUseCase,
    private readonly createPlan: CreatePlanUseCase,
    private readonly updatePlan: UpdatePlanUseCase,
  ) {}

  @Get()
  @Roles('ADMIN', 'RECEPCIONISTA', 'NUTRICIONISTA')
  list(@Query() q: ListPlansQueryDto): Promise<PlanView[]> {
    return this.listPlans.execute(q.includeInactive ?? false);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() body: PlanInputDto, @Ctx() ctx: RequestContext): Promise<PlanView> {
    return this.createPlan.execute(ctx, body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', uuidPipe) id: string, @Body() body: PlanInputDto, @Ctx() ctx: RequestContext): Promise<PlanView> {
    return this.updatePlan.execute(ctx, id, body);
  }
}

@Controller('attendances')
@Roles('ADMIN', 'RECEPCIONISTA')
export class AttendancesController {
  constructor(
    private readonly listAttendances: ListAttendancesUseCase,
    private readonly createAttendance: CreateAttendanceUseCase,
    private readonly searchMembers: SearchMembersForCheckInUseCase,
    private readonly riskList: ListAttendanceRiskUseCase,
    private readonly summaryUc: GetAttendanceSummaryUseCase,
    private readonly updateAttendance: UpdateAttendanceUseCase,
    private readonly voidAttendance: VoidAttendanceUseCase,
  ) {}

  @Get()
  list(@Query() q: ListAttendancesQueryDto): ReturnType<ListAttendancesUseCase['execute']> {
    return this.listAttendances.execute(q);
  }

  @Post()
  create(@Body() body: CreateAttendanceDto, @Ctx() ctx: RequestContext): Promise<AttendanceView> {
    return this.createAttendance.execute(ctx, body);
  }

  @Get('search-members')
  search(@Query() q: SearchMembersQueryDto): Promise<CheckInSuggestionView[]> {
    return this.searchMembers.execute(q.q, q.limit);
  }

  @Get('risk')
  risk(@Query() q: AttendanceRiskQueryDto): Promise<PageView<AttendanceRiskRowView>> {
    return this.riskList.execute(q);
  }

  @Get('summary')
  summary(): ReturnType<GetAttendanceSummaryUseCase['execute']> {
    return this.summaryUc.execute();
  }

  @Patch(':id')
  update(@Param('id', uuidPipe) id: string, @Body() body: UpdateAttendanceDto, @Ctx() ctx: RequestContext): Promise<AttendanceView> {
    return this.updateAttendance.execute(ctx, id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  voidOne(@Param('id', uuidPipe) id: string, @Body() body: VoidDto, @Ctx() ctx: RequestContext): Promise<AttendanceView> {
    return this.voidAttendance.execute(ctx, id, body);
  }
}

@Controller('cash')
@Roles('ADMIN', 'RECEPCIONISTA')
export class CashController {
  constructor(
    private readonly listMovements: ListCashMovementsUseCase,
    private readonly createMovement: CreateCashMovementUseCase,
    private readonly getMovement: GetCashMovementUseCase,
    private readonly updateMovement: UpdateCashMovementUseCase,
    private readonly voidMovement: VoidCashMovementUseCase,
    private readonly summaryUc: GetCashSummaryUseCase,
    private readonly listCategories: ListCategoriesUseCase,
    private readonly createCategory: CreateCategoryUseCase,
    private readonly updateCategory: UpdateCategoryUseCase,
  ) {}

  @Get('movements')
  list(@Query() q: ListCashMovementsQueryDto): ReturnType<ListCashMovementsUseCase['execute']> {
    return this.listMovements.execute(q);
  }

  @Post('movements')
  create(@Body() body: CreateCashMovementDto, @Ctx() ctx: RequestContext): Promise<CashMovementView> {
    return this.createMovement.execute(ctx, body);
  }

  @Get('movements/:id')
  get(@Param('id', uuidPipe) id: string): Promise<CashMovementView> {
    return this.getMovement.execute(id);
  }

  @Patch('movements/:id')
  update(
    @Param('id', uuidPipe) id: string,
    @Body() body: UpdateCashMovementDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CashMovementView> {
    return this.updateMovement.execute(ctx, id, body);
  }

  @Post('movements/:id/void')
  @HttpCode(200)
  voidOne(@Param('id', uuidPipe) id: string, @Body() body: CashVoidDto, @Ctx() ctx: RequestContext): Promise<CashMovementView> {
    return this.voidMovement.execute(ctx, id, body);
  }

  @Get('summary')
  summary(@Query() q: CashFilterQueryDto): Promise<CashTotalsView> {
    return this.summaryUc.execute(q);
  }

  @Get('categories')
  categories(@Query() q: ListCategoriesQueryDto): Promise<CashCategoryView[]> {
    return this.listCategories.execute(q);
  }

  @Post('categories')
  @Roles('ADMIN')
  createCat(@Body() body: CashCategoryInputDto, @Ctx() ctx: RequestContext): Promise<CashCategoryView> {
    return this.createCategory.execute(ctx, body);
  }

  @Patch('categories/:id')
  @Roles('ADMIN')
  updateCat(
    @Param('id', uuidPipe) id: string,
    @Body() body: CashCategoryInputDto,
    @Ctx() ctx: RequestContext,
  ): Promise<CashCategoryView> {
    return this.updateCategory.execute(ctx, id, body);
  }
}
