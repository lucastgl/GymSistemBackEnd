import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { AuthController, UsersController } from '../../src/presentation/controllers/auth-users.controller';
import { HealthController } from '../../src/presentation/controllers/health.controller';
import { IncentivesController, StaffMembersController } from '../../src/presentation/controllers/incentives.controller';
import {
  AuditController,
  LeadsController,
  MetricsController,
  NutritionController,
  SettingsController,
} from '../../src/presentation/controllers/insights.controller';
import { MembersController, MembershipsController } from '../../src/presentation/controllers/members.controller';
import { AttendancesController, CashController, PlansController } from '../../src/presentation/controllers/operations.controller';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../src/presentation/http/http-context';

type Operation = { 'x-roles'?: string[]; security?: unknown[]; responses?: Record<string, unknown> };
type Spec = { paths: Record<string, Record<string, Operation>> };

const CONTROLLERS = [
  HealthController,
  AuthController,
  UsersController,
  PlansController,
  MembersController,
  MembershipsController,
  AttendancesController,
  CashController,
  MetricsController,
  NutritionController,
  LeadsController,
  AuditController,
  SettingsController,
  StaffMembersController,
  IncentivesController,
];

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

interface Route {
  key: string;
  roles: string[] | 'PUBLIC';
  status: number;
}

function implementedRoutes(): Route[] {
  const routes: Route[] = [];
  for (const ctrl of CONTROLLERS) {
    const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
    const classRoles = Reflect.getMetadata(ROLES_KEY, ctrl) as string[] | undefined;
    const proto = ctrl.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (sub === undefined || method === undefined) continue;
      const path = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/:(\w+)/g, '{$1}');
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
      const roles = (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ?? classRoles ?? [];
      const verb = RequestMethod[method].toLowerCase();
      const explicit = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
      routes.push({
        key: `${verb.toUpperCase()} ${path}`,
        roles: isPublic ? 'PUBLIC' : [...roles].sort(),
        status: explicit ?? (verb === 'post' ? 201 : 200),
      });
    }
  }
  return routes;
}

function contractRoutes(): Route[] {
  const spec = load(readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.yaml'), 'utf8')) as Spec;
  const out: Route[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const verb of METHODS) {
      const op = item[verb];
      if (!op) continue;
      const success = Object.keys(op.responses ?? {}).filter((c) => /^2\d\d$/.test(c)).map(Number);
      out.push({
        key: `${verb.toUpperCase()} ${path}`,
        roles: Array.isArray(op.security) && op.security.length === 0 ? 'PUBLIC' : [...(op['x-roles'] ?? [])].sort(),
        status: Math.min(...success),
      });
    }
  }
  return out;
}

describe('contrato docs/05 ↔ controllers', () => {
  const impl = implementedRoutes();
  const contract = contractRoutes();

  it('el contrato tiene 57 rutas y 73 operaciones (Fase 4: equipo y objetivos)', () => {
    expect(new Set(contract.map((r) => r.key.split(' ')[1])).size).toBe(57);
    expect(contract).toHaveLength(73);
  });

  it('cada operación del contrato está implementada exactamente una vez y no hay rutas extra', () => {
    expect(impl.map((r) => r.key).sort()).toEqual(contract.map((r) => r.key).sort());
  });

  it('@Roles coincide con x-roles (y las públicas con security: [])', () => {
    const byKey = new Map(impl.map((r) => [r.key, r.roles]));
    for (const c of contract) expect([c.key, byKey.get(c.key)]).toEqual([c.key, c.roles]);
  });

  it('el código de éxito coincide con el contrato (200/201/204)', () => {
    const byKey = new Map(impl.map((r) => [r.key, r.status]));
    for (const c of contract) expect([c.key, byKey.get(c.key)]).toEqual([c.key, c.status]);
  });
});
