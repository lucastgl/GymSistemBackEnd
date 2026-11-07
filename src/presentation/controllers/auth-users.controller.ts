import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  AuthTokensView,
  ChangePasswordUseCase,
  GetMeUseCase,
  LoginUseCase,
  LoginView,
  LogoutUseCase,
  RefreshSessionUseCase,
} from '../../application/auth/auth.use-cases';
import {
  CreatedUserView,
  CreateUserUseCase,
  GetUserUseCase,
  ListUsersUseCase,
  ResetUserPasswordUseCase,
  UpdateUserUseCase,
} from '../../application/users/users.use-cases';
import { PageView, UserView } from '../../application/common/views';
import { Errors } from '../../domain/shared/errors';
import { RequestContext, RequestMeta } from '../../domain/shared/request-context';
import { ChangePasswordDto, CreateUserDto, ListUsersQueryDto, LoginDto, RefreshTokenDto, UpdateUserDto } from '../dto/auth-users.dto';
import { AllowPendingPasswordChange, Ctx, Meta, Public, Roles } from '../http/http-context';

/** `:id` UUID → 400 VALIDATION_ERROR con el formato de ErrorResponse. */
export const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => Errors.field('id', 'El identificador debe ser un UUID válido'),
});

export const ALL_ROLES = ['ADMIN', 'RECEPCIONISTA', 'NUTRICIONISTA', 'ALUMNO'] as const;

@Controller('auth')
@AllowPendingPasswordChange()
export class AuthController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshSessionUseCase,
    private readonly logout: LogoutUseCase,
    private readonly changePassword: ChangePasswordUseCase,
    private readonly me: GetMeUseCase,
  ) {}

  /** POST /auth/login · público. */
  @Post('login')
  @Public()
  @HttpCode(200)
  doLogin(@Body() body: LoginDto, @Meta() meta: RequestMeta): Promise<LoginView> {
    return this.login.execute(body, meta);
  }

  /** POST /auth/refresh · público. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  doRefresh(@Body() body: RefreshTokenDto, @Meta() meta: RequestMeta): Promise<AuthTokensView> {
    return this.refresh.execute(body.refreshToken, meta);
  }

  /** POST /auth/logout · x-roles: todos. */
  @Post('logout')
  @Roles(...ALL_ROLES)
  @HttpCode(204)
  async doLogout(@Body() body: RefreshTokenDto, @Ctx() ctx: RequestContext): Promise<void> {
    await this.logout.execute(ctx, body.refreshToken);
  }

  /** POST /auth/change-password · x-roles: todos. */
  @Post('change-password')
  @Roles(...ALL_ROLES)
  @HttpCode(200)
  doChangePassword(@Body() body: ChangePasswordDto, @Ctx() ctx: RequestContext): Promise<AuthTokensView> {
    return this.changePassword.execute(ctx, body);
  }

  /** GET /auth/me · x-roles: todos. */
  @Get('me')
  @Roles(...ALL_ROLES)
  getMe(@Ctx() ctx: RequestContext): Promise<UserView> {
    return this.me.execute(ctx);
  }
}

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsersUseCase,
    private readonly createUser: CreateUserUseCase,
    private readonly getUser: GetUserUseCase,
    private readonly updateUser: UpdateUserUseCase,
    private readonly resetPassword: ResetUserPasswordUseCase,
  ) {}

  @Get()
  list(@Query() q: ListUsersQueryDto): Promise<PageView<UserView>> {
    return this.listUsers.execute(q);
  }

  @Post()
  create(@Body() body: CreateUserDto, @Ctx() ctx: RequestContext): Promise<CreatedUserView> {
    return this.createUser.execute(ctx, body);
  }

  @Get(':id')
  get(@Param('id', uuidPipe) id: string): Promise<UserView> {
    return this.getUser.execute(id);
  }

  @Patch(':id')
  update(@Param('id', uuidPipe) id: string, @Body() body: UpdateUserDto, @Ctx() ctx: RequestContext): Promise<UserView> {
    return this.updateUser.execute(ctx, id, body);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  reset(@Param('id', uuidPipe) id: string, @Ctx() ctx: RequestContext): Promise<{ temporaryPassword: string }> {
    return this.resetPassword.execute(ctx, id);
  }
}
