import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { SessionUser } from '../../application/auth/auth.use-cases';
import { Role } from '../../domain/shared/enums';
import { RequestContext, RequestMeta } from '../../domain/shared/request-context';

export interface AppRequest extends Request {
  user?: SessionUser;
  requestId?: string;
}

export const IS_PUBLIC_KEY = 'lb:isPublic';
export const ROLES_KEY = 'lb:roles';
export const ALLOW_PENDING_PASSWORD_KEY = 'lb:allowPendingPassword';

/** Ruta sin autenticación (login, refresh, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Roles permitidos: copia exacta de `x-roles` de docs/05. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/** Rutas de `/auth/*`: accesibles aunque el usuario deba cambiar la contraseña. */
export const AllowPendingPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

export function requestMeta(req: AppRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    requestId: req.requestId ?? null,
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null,
  };
}

export function requestContext(req: AppRequest): RequestContext {
  const user = req.user;
  return {
    actor: user
      ? { userId: user.id, label: user.fullName, role: user.role }
      : { userId: null, label: 'anónimo', role: null },
    meta: requestMeta(req),
  };
}

/** Inyecta el contexto (actor + requestId, ip, user agent) para los casos de uso. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext =>
  requestContext(ctx.switchToHttp().getRequest<AppRequest>()),
);

/** Solo metadatos de la petición (rutas públicas). */
export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<AppRequest>()),
);
