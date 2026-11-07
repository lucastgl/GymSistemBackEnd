import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ListMemberAttendancesUseCase } from '../../application/attendances/attendances.use-cases';
import {
  AutoCancellationResult,
  CancelMemberUseCase,
  CreateMemberUseCase,
  DeleteMemberUseCase,
  GetMemberDetailUseCase,
  GetMemberSummaryUseCase,
  GetWhatsappLinkUseCase,
  ListMemberMembershipsUseCase,
  ListMembersUseCase,
  ListMemberStatusEventsUseCase,
  MemberSummaryView,
  ReactivateMemberUseCase,
  RunAutoCancellationsUseCase,
  UpdateMemberUseCase,
} from '../../application/members/members.use-cases';
import {
  CreateMembershipUseCase,
  GetMembershipUseCase,
  ListMembershipsUseCase,
  UpdateMembershipUseCase,
  VoidMembershipUseCase,
} from '../../application/memberships/memberships.use-cases';
import {
  AttendanceView,
  MemberDetailView,
  MemberStatusEventView,
  MemberView,
  MembershipView,
  PageView,
} from '../../application/common/views';
import { RequestContext } from '../../domain/shared/request-context';
import { PageQueryDto } from '../dto/common.dto';
import {
  CancelMemberDto,
  CreateMemberDto,
  CreateMembershipDto,
  IncludeVoidedQueryDto,
  ListMembershipsQueryDto,
  ListMembersQueryDto,
  UpdateMemberDto,
  UpdateMembershipDto,
  VoidDto,
  WhatsappLinkQueryDto,
} from '../dto/members.dto';
import { Ctx, Roles } from '../http/http-context';
import { uuidPipe } from './auth-users.controller';

@Controller('members')
@Roles('ADMIN', 'RECEPCIONISTA')
export class MembersController {
  constructor(
    private readonly listMembers: ListMembersUseCase,
    private readonly createMember: CreateMemberUseCase,
    private readonly summaryUc: GetMemberSummaryUseCase,
    private readonly autoCancel: RunAutoCancellationsUseCase,
    private readonly detail: GetMemberDetailUseCase,
    private readonly updateMember: UpdateMemberUseCase,
    private readonly deleteMember: DeleteMemberUseCase,
    private readonly cancelMember: CancelMemberUseCase,
    private readonly reactivateMember: ReactivateMemberUseCase,
    private readonly whatsapp: GetWhatsappLinkUseCase,
    private readonly memberMemberships: ListMemberMembershipsUseCase,
    private readonly createMembership: CreateMembershipUseCase,
    private readonly memberAttendances: ListMemberAttendancesUseCase,
    private readonly statusEvents: ListMemberStatusEventsUseCase,
  ) {}

  @Get()
  list(@Query() q: ListMembersQueryDto): Promise<PageView<MemberView>> {
    return this.listMembers.execute(q);
  }

  @Post()
  create(
    @Body() body: CreateMemberDto,
    @Ctx() ctx: RequestContext,
  ): Promise<{ member: MemberView; membership: MembershipView | null; warnings: string[] }> {
    return this.createMember.execute(ctx, body);
  }

  @Get('summary')
  summary(): Promise<MemberSummaryView> {
    return this.summaryUc.execute();
  }

  @Post('auto-cancellations')
  @Roles('ADMIN')
  @HttpCode(200)
  runAutoCancellations(@Ctx() ctx: RequestContext): Promise<AutoCancellationResult> {
    return this.autoCancel.execute(ctx);
  }

  @Get(':id')
  get(@Param('id', uuidPipe) id: string): Promise<MemberDetailView> {
    return this.detail.execute(id);
  }

  @Patch(':id')
  update(@Param('id', uuidPipe) id: string, @Body() body: UpdateMemberDto, @Ctx() ctx: RequestContext): Promise<MemberView> {
    return this.updateMember.execute(ctx, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  async remove(@Param('id', uuidPipe) id: string, @Ctx() ctx: RequestContext): Promise<void> {
    await this.deleteMember.execute(ctx, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', uuidPipe) id: string, @Body() body: CancelMemberDto, @Ctx() ctx: RequestContext): Promise<MemberView> {
    return this.cancelMember.execute(ctx, id, body);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id', uuidPipe) id: string, @Ctx() ctx: RequestContext): Promise<MemberView> {
    return this.reactivateMember.execute(ctx, id);
  }

  @Get(':id/whatsapp-link')
  whatsappLink(@Param('id', uuidPipe) id: string, @Query() q: WhatsappLinkQueryDto): Promise<{ url: string; message: string }> {
    return this.whatsapp.execute(id, q.template);
  }

  @Get(':id/memberships')
  memberships(@Param('id', uuidPipe) id: string, @Query() q: IncludeVoidedQueryDto): Promise<MembershipView[]> {
    return this.memberMemberships.execute(id, q.includeVoided ?? false);
  }

  @Post(':id/memberships')
  renew(
    @Param('id', uuidPipe) id: string,
    @Body() body: CreateMembershipDto,
    @Ctx() ctx: RequestContext,
  ): Promise<{ membership: MembershipView; member: MemberView; warnings: string[] }> {
    return this.createMembership.execute(ctx, id, body);
  }

  @Get(':id/attendances')
  attendances(@Param('id', uuidPipe) id: string, @Query() q: PageQueryDto): Promise<PageView<AttendanceView>> {
    return this.memberAttendances.execute(id, q);
  }

  @Get(':id/status-events')
  events(@Param('id', uuidPipe) id: string): Promise<MemberStatusEventView[]> {
    return this.statusEvents.execute(id);
  }
}

@Controller('memberships')
@Roles('ADMIN', 'RECEPCIONISTA')
export class MembershipsController {
  constructor(
    private readonly listMemberships: ListMembershipsUseCase,
    private readonly getMembership: GetMembershipUseCase,
    private readonly updateMembership: UpdateMembershipUseCase,
    private readonly voidMembership: VoidMembershipUseCase,
  ) {}

  @Get()
  list(@Query() q: ListMembershipsQueryDto): ReturnType<ListMembershipsUseCase['execute']> {
    return this.listMemberships.execute(q);
  }

  @Get(':id')
  get(@Param('id', uuidPipe) id: string): Promise<MembershipView> {
    return this.getMembership.execute(id);
  }

  @Patch(':id')
  update(@Param('id', uuidPipe) id: string, @Body() body: UpdateMembershipDto, @Ctx() ctx: RequestContext): Promise<MembershipView> {
    return this.updateMembership.execute(ctx, id, body);
  }

  @Post(':id/void')
  @HttpCode(200)
  voidOne(@Param('id', uuidPipe) id: string, @Body() body: VoidDto, @Ctx() ctx: RequestContext): Promise<MembershipView> {
    return this.voidMembership.execute(ctx, id, body);
  }
}
