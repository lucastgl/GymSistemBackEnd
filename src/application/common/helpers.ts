import { Repositories, PageRequest } from '../../domain/repositories/repositories';
import { BusinessSettings } from '../../domain/settings/business-settings';
import { Errors } from '../../domain/shared/errors';
import { RequestContext } from '../../domain/shared/request-context';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function pageRequest(page?: number, pageSize?: number): PageRequest {
  const p = Number.isInteger(page) && (page as number) >= 1 ? (page as number) : 1;
  const s = Number.isInteger(pageSize) && (pageSize as number) >= 1 ? Math.min(pageSize as number, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page: p, pageSize: s };
}

/** Lee `settings` y devuelve el lector tipado (con defaults del catálogo). */
export async function loadSettings(repos: Pick<Repositories, 'settings'>): Promise<BusinessSettings> {
  const rows = await repos.settings.getAll();
  return new BusinessSettings(new Map(rows.map((r) => [r.key, r.value])));
}

/** Usuario autenticado obligatorio (los casos de uso de escritura lo requieren). */
export function requireUserId(ctx: RequestContext): string {
  if (!ctx.actor.userId) throw Errors.unauthorized('UNAUTHORIZED', 'Sesión requerida');
  return ctx.actor.userId;
}

/** `undefined` = no se envió; `null` = se envió vacío. */
export function isProvided<T>(value: T | undefined): value is T {
  return value !== undefined;
}
