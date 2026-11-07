import { AuditAction, AuditEntity } from '../shared/enums';
import { RequestContext } from '../shared/request-context';

/** Lo que un caso de uso informa para auditar una escritura (04 §3.8). */
export interface AuditEntryInput {
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  passwordConfirmed?: boolean;
}

/** Registro listo para persistir. */
export interface AuditRecord {
  occurredAt: Date;
  userId: string | null;
  actorLabel: string;
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  passwordConfirmed: boolean;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Claves que nunca pueden quedar en la auditoría (hash de contraseña, tokens, contraseñas
 * ingresadas). Se comparan sin mayúsculas ni guiones bajos.
 */
const FORBIDDEN_KEYS = new Set(
  [
    'password',
    'passwordHash',
    'password_hash',
    'confirmPassword',
    'currentPassword',
    'newPassword',
    'temporaryPassword',
    'token',
    'tokenHash',
    'token_hash',
    'refreshToken',
    'accessToken',
  ].map((k) => k.toLowerCase().replace(/_/g, '')),
);

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase().replace(/_/g, ''));
}

function sanitizeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) continue;
      const s = sanitizeValue(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Copia serializable sin claves prohibidas (fechas a ISO, `undefined` eliminado). */
export function sanitizeForAudit(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (obj === null || obj === undefined) return null;
  return sanitizeValue(obj) as Record<string, unknown>;
}

/** Campos de primer nivel cuyo valor cambió entre `before` y `after`. */
export function computeChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (before === null && after === null) return [];
  if (before === null) return Object.keys(after ?? {}).filter((k) => (after ?? {})[k] !== null);
  if (after === null) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).sort();
}

export function buildAuditRecord(input: AuditEntryInput, ctx: RequestContext, now: Date): AuditRecord {
  const before = sanitizeForAudit(input.before ?? null);
  const after = sanitizeForAudit(input.after ?? null);
  return {
    occurredAt: now,
    userId: ctx.actor.userId,
    actorLabel: ctx.actor.label,
    entity: input.entity,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    action: input.action,
    before,
    after,
    changedFields: computeChangedFields(before, after),
    passwordConfirmed: input.passwordConfirmed === true,
    requestId: ctx.meta.requestId,
    ip: ctx.meta.ip,
    userAgent: ctx.meta.userAgent,
  };
}
