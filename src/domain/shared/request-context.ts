import { Role } from './enums';

/** Quién ejecuta una operación. `userId = null` para procesos automáticos (`system`). */
export interface Actor {
  userId: string | null;
  label: string;
  role: Role | null;
}

/** Metadatos de la petición que van a la auditoría (04 §3.8). */
export interface RequestMeta {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface RequestContext {
  actor: Actor;
  meta: RequestMeta;
}

export const SYSTEM_ACTOR_LABEL = 'system';

export function systemContext(): RequestContext {
  return {
    actor: { userId: null, label: SYSTEM_ACTOR_LABEL, role: null },
    meta: { requestId: null, ip: null, userAgent: null },
  };
}
