import { Body, Controller, Get, HttpCode, Param, Patch, PipeTransform, Post, Query } from '@nestjs/common';
import { StaffMemberView, StaffOptionView } from '../../application/common/views';
import {
  CloseIncentivePeriodUseCase,
  GetIncentivePeriodUseCase,
  GetIncentivePlanUseCase,
  GetIncentivesHistoryUseCase,
  IncentivePeriodDetailView,
  IncentivesHistoryView,
  PublishIncentivePeriodUseCase,
} from '../../application/incentives/incentives.use-cases';
import {
  CreateStaffMemberUseCase,
  ListStaffMembersUseCase,
  ListStaffOptionsUseCase,
  UpdateStaffMemberUseCase,
} from '../../application/staff/staff.use-cases';
import { IncentivePlan } from '../../domain/incentives/incentive-plan';
import { Errors } from '../../domain/shared/errors';
import { Period } from '../../domain/shared/period';
import { RequestContext } from '../../domain/shared/request-context';
import {
  CloseIncentivePeriodDto,
  IncentivePlanQueryDto,
  IncentivesHistoryQueryDto,
  PublishIncentivePeriodDto,
} from '../dto/incentives.dto';
import { ListStaffMembersQueryDto, StaffMemberInputDto, StaffMemberPatchDto } from '../dto/staff.dto';
import { Ctx, Roles } from '../http/http-context';
import { uuidPipe } from './auth-users.controller';

/** Parámetro de ruta `{period}` (PeriodPath de docs/05: `AAAA-MM`). */
export const periodPipe: PipeTransform<string, string> = {
  transform(value: string): string {
    if (!Period.isValid(value)) throw Errors.field('period', 'Período inválido (se espera AAAA-MM)', value);
    return value;
  },
};

/** Equipo (HU-OBJ-06): ABM solo ADMIN; el selector "Vendido por" también para RECEPCIONISTA. */
@Controller('staff-members')
@Roles('ADMIN')
export class StaffMembersController {
  constructor(
    private readonly listStaff: ListStaffMembersUseCase,
    private readonly createStaff: CreateStaffMemberUseCase,
    private readonly updateStaff: UpdateStaffMemberUseCase,
    private readonly listOptions: ListStaffOptionsUseCase,
  ) {}

  @Get()
  list(@Query() q: ListStaffMembersQueryDto): Promise<StaffMemberView[]> {
    return this.listStaff.execute(q);
  }

  @Post()
  create(@Body() body: StaffMemberInputDto, @Ctx() ctx: RequestContext): Promise<StaffMemberView> {
    return this.createStaff.execute(ctx, body);
  }

  @Get('options')
  @Roles('ADMIN', 'RECEPCIONISTA')
  options(@Ctx() ctx: RequestContext): Promise<StaffOptionView[]> {
    return this.listOptions.execute(ctx);
  }

  @Patch(':id')
  update(@Param('id', uuidPipe) id: string, @Body() body: StaffMemberPatchDto, @Ctx() ctx: RequestContext): Promise<StaffMemberView> {
    return this.updateStaff.execute(ctx, id, body);
  }
}

/** Objetivos y bonos del equipo (HU-OBJ-01..05, docs/03 §8). Solo ADMIN (D12.4). */
@Controller('incentives')
@Roles('ADMIN')
export class IncentivesController {
  constructor(
    private readonly historyUc: GetIncentivesHistoryUseCase,
    private readonly planUc: GetIncentivePlanUseCase,
    private readonly periodUc: GetIncentivePeriodUseCase,
    private readonly publishUc: PublishIncentivePeriodUseCase,
    private readonly closeUc: CloseIncentivePeriodUseCase,
  ) {}

  @Get('history')
  history(@Query() q: IncentivesHistoryQueryDto): Promise<IncentivesHistoryView> {
    return this.historyUc.execute(q);
  }

  @Get('plan')
  plan(@Query() q: IncentivePlanQueryDto): Promise<IncentivePlan> {
    return this.planUc.execute(q);
  }

  @Get('periods/:period')
  period(@Param('period', periodPipe) period: string): Promise<IncentivePeriodDetailView> {
    return this.periodUc.execute(period);
  }

  @Post('periods/:period/publish')
  @HttpCode(200)
  publish(
    @Param('period', periodPipe) period: string,
    @Body() body: PublishIncentivePeriodDto,
    @Ctx() ctx: RequestContext,
  ): Promise<IncentivePeriodDetailView> {
    return this.publishUc.execute(ctx, period, body);
  }

  @Post('periods/:period/close')
  @HttpCode(200)
  close(
    @Param('period', periodPipe) period: string,
    @Body() body: CloseIncentivePeriodDto,
    @Ctx() ctx: RequestContext,
  ): Promise<IncentivePeriodDetailView> {
    return this.closeUc.execute(ctx, period, body);
  }
}
