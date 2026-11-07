import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ResolveSessionUserUseCase } from '../../application/auth/auth.use-cases';
import { Role } from '../../domain/shared/enums';
import { ErrorCodes, Errors } from '../../domain/shared/errors';
import { ALLOW_PENDING_PASSWORD_KEY, AppRequest, IS_PUBLIC_KEY, ROLES_KEY } from './http-context';

function flag(reflector: Reflector, key: string, ctx: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]) === true;
}

/** Guard global: exige `Authorization: Bearer <accessToken>` y carga el usuario vigente. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolveUser: ResolveSessionUserUseCase,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (flag(this.reflector, IS_PUBLIC_KEY, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw Errors.unauthorized(ErrorCodes.UNAUTHORIZED, 'Sesión requerida');
    }
    const user = await this.resolveUser.execute(token);
    if (!user) throw Errors.unauthorized(ErrorCodes.UNAUTHORIZED, 'La sesión expiró o no es válida');
    req.user = user;
    return true;
  }
}

/** Con `mustChangePassword = true`, todo lo que no sea `/auth/*` responde 403 PASSWORD_CHANGE_REQUIRED. */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (flag(this.reflector, IS_PUBLIC_KEY, ctx) || flag(this.reflector, ALLOW_PENDING_PASSWORD_KEY, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (req.user?.mustChangePassword) {
      throw Errors.forbidden(ErrorCodes.PASSWORD_CHANGE_REQUIRED, 'Tenés que cambiar tu contraseña antes de continuar');
    }
    return true;
  }
}

/** Autorización por rol según `@Roles` (= `x-roles`). Sin `@Roles` se niega por defecto. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (flag(this.reflector, IS_PUBLIC_KEY, ctx)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!roles || !user || !roles.includes(user.role)) {
      throw Errors.forbidden(ErrorCodes.FORBIDDEN, 'No tenés permisos para esta operación');
    }
    return true;
  }
}
