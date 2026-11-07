/**
 * Prueba e2e contra PostgreSQL 16 en Docker con los scripts reales de ../sql (ver scripts/integration.js).
 * Usa las credenciales iniciales de ../sql/.env (sin imprimirlas) para comprobar que los hashes
 * argon2id que genera sql/tools validan en el backend.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { StartupRecoveryUseCase } from '../../src/application/jobs/scheduled-jobs.use-cases';
import { AppModule } from '../../src/composition/app.module';
import { configureApp } from '../../src/composition/configure-app';
import { loadAppConfig } from '../../src/infrastructure/config/app-config';

function readSeedEnv(): Record<string, string> {
  const raw = readFileSync(join(__dirname, '..', '..', '..', 'sql', '.env'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Tabla de 03 §6b (reconstrucción V1, abril–octubre 2026; octubre en curso al 26/10). */
const PERIODS_6B = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const TABLE_6B: Record<string, (number | null)[]> = {
  members_active_start: [84, 83, 79, 74, 77, 90, 94],
  members_active_end: [83, 79, 74, 77, 90, 94, 98],
  members_paying_end: [59, 59, 62, 69, 77, 86, 81],
  members_new: [12, 12, 6, 11, 19, 5, 10],
  members_cancelled: [13, 16, 15, 10, 11, 12, 15],
  avg_tenure_months: [3.4, 6.9, 4.1, 6.5, 7.3, 6.3, 8.3],
  renewals: [61, 57, 62, 68, 75, 80, 76],
  expirations: [null, 61, 57, 66, 63, 73, 86],
  expirations_not_renewed: [null, 15, 11, 9, 13, 14, 31],
  churn_pct: [null, 24.6, 19.3, 13.6, 20.6, 19.2, 36.0],
  income_renewals: [2405000, 2798000, 2840000, 3366000, 3947000, 3790300, 4094732],
  income_other: [0, 20000, 2000, 69000, 10800, 0, 448760],
  income_total: [2405000, 2818000, 2842000, 3435000, 3957800, 3790300, 4543492],
  expenses_total: [1951023.85, 199988, 83010.96, 311260, 317198.71, 185600, 1121355],
  margin: [453976.15, 2618012, 2758989.04, 3123740, 3640601.29, 3604700, 3422137],
  margin_pct: [18.9, 92.9, 97.1, 90.9, 92.0, 95.1, 75.3],
  avg_ticket: [39426, 49088, 45806, 49500, 52627, 47379, 53878],
  attendances_total: [null, 524, 560, 523, 662, 809, 575],
  attendees_distinct: [null, 69, 67, 74, 89, 92, 99],
  leads_total: [8, 15, 12, 8, 19, 3, 14],
  leads_signed_pct: [25.0, 33.3, 41.7, 75.0, 52.6, 33.3, 28.6],
};

describe('API e2e (PostgreSQL 16 en Docker)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const seed = readSeedEnv();
  const adminEmail = seed.SEED_ADMIN_EMAIL!;
  const recepEmail = seed.SEED_RECEPCIONISTA_2_EMAIL!;
  const newAdminPassword = 'AdminNuevo2026';
  const newRecepPassword = 'MarielNueva2026';
  let adminToken = '';
  let recepToken = '';
  let recepId = '';
  let planId = '';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'e2e-secret-de-prueba-con-mas-de-32-caracteres';
    process.env.JOBS_ENABLED = 'false';
    process.env.FIXED_NOW = '2026-10-26T15:00:00-03:00';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadAppConfig());
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('GET /health es público', async () => {
    const res = await http.get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('login con la contraseña temporal del seed (hash de sql/tools), cambio obligatorio y nuevo par de tokens', async () => {
    const bad = await http.post('/api/v1/auth/login').send({ email: adminEmail, password: 'incorrecta' }).expect(401);
    expect(bad.body).toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas' });
    expect(bad.body.requestId).toEqual(expect.any(String));

    const login = await http.post('/api/v1/auth/login').send({ email: adminEmail, password: seed.SEED_ADMIN_PASSWORD }).expect(200);
    expect(login.body.user).toMatchObject({ email: adminEmail, role: 'ADMIN', mustChangePassword: true });
    expect(login.body.expiresIn).toBe(900);

    const blocked = await http.get('/api/v1/members').set(auth(login.body.accessToken)).expect(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await http
      .post('/api/v1/auth/change-password')
      .set(auth(login.body.accessToken))
      .send({ currentPassword: seed.SEED_ADMIN_PASSWORD, newPassword: newAdminPassword })
      .expect(200);
    adminToken = changed.body.accessToken;
    const me = await http.get('/api/v1/auth/me').set(auth(adminToken)).expect(200);
    expect(me.body.mustChangePassword).toBe(false);
    await http.post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);

    const recep = await http.post('/api/v1/auth/login').send({ email: recepEmail, password: seed.SEED_RECEPCIONISTA_2_PASSWORD }).expect(200);
    recepId = recep.body.user.id;
    const recepChanged = await http
      .post('/api/v1/auth/change-password')
      .set(auth(recep.body.accessToken))
      .send({ currentPassword: seed.SEED_RECEPCIONISTA_2_PASSWORD, newPassword: newRecepPassword })
      .expect(200);
    recepToken = recepChanged.body.accessToken;
    // RECEPCIONISTA no ve métricas (x-roles: ADMIN).
    const forbidden = await http.get('/api/v1/metrics/months').set(auth(recepToken)).expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
  });

  it('octubre en vivo (antes de escribir datos) coincide con la columna "en curso" de 03 §6b', async () => {
    const live = await http.get('/api/v1/metrics/monthly?period=2026-10').set(auth(adminToken)).expect(200);
    expect(live.body).toMatchObject({ source: 'LIVE', isCurrentMonth: true, isClosed: false, snapshot: null });
    const got = Object.fromEntries(Object.keys(TABLE_6B).map((k) => [k, live.body.values[k].value]));
    const expected = Object.fromEntries(Object.entries(TABLE_6B).map(([k, v]) => [k, v[6]]));
    expect(got).toEqual(expected);
    expect(live.body.values.churn_pct.isProvisional).toBe(true);
    expect(live.body.values.expirations_not_renewed.isProvisional).toBe(true);
    expect(live.body.parameters).toMatchObject({ fixedCostsTotal: 1310000, marketRent: 1100000, renewalGraceDays: 15, goals: { churnPct: 18 } });
  });

  it('padrón importado: lista paginada por prioridad y resumen sobre todo el padrón', async () => {
    const summary = await http.get('/api/v1/members/summary').set(auth(adminToken)).expect(200);
    expect(summary.body.registered).toBe(187);
    const page = await http.get('/api/v1/members?pageSize=5').set(auth(adminToken)).expect(200);
    expect(page.body.items).toHaveLength(5);
    expect(page.body.total).toBe(summary.body.registered - summary.body.cancelled);
    const order = ['EXPIRED', 'DUE_TODAY', 'DUE_3D', 'DUE_7D', 'OK', 'UNKNOWN', 'CANCELLED'];
    const ranks = page.body.items.map((m: { renewalStatus: string }) => order.indexOf(m.renewalStatus));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const search = await http.get('/api/v1/members?q=PEREZ&status=CANCELLED').set(auth(adminToken)).expect(200);
    expect(search.body).toHaveProperty('total');
  });

  it('equipo (Fase 4): ADMIN vincula a la recepcionista; RECEPCIONISTA ve las opciones pero no objetivos ni el ABM', async () => {
    await http.get('/api/v1/staff-members').set(auth(recepToken)).expect(403);
    const created = await http
      .post('/api/v1/staff-members')
      .set(auth(adminToken))
      .send({ displayName: 'Maru', userId: recepId, isBonusEligible: true, sortOrder: 2 })
      .expect(201);
    expect(created.body).toMatchObject({ displayName: 'Maru', user: { id: recepId }, isBonusEligible: true, isActive: true });
    const options = await http.get('/api/v1/staff-members/options').set(auth(recepToken)).expect(200);
    expect(options.body).toEqual([{ id: created.body.id, displayName: 'Maru', isCurrentUser: true }]);
    await http.get('/api/v1/incentives/plan').set(auth(recepToken)).expect(403);
    // Octubre visto el 26/10: W = mayo–septiembre (meses cerrados); altas con cobro de 03 y ticket de jul–sep.
    const plan = await http.get('/api/v1/incentives/plan?period=2026-10').set(auth(adminToken)).expect(200);
    expect(plan.body.inputs.newMembersByPeriod.map((m: { count: number }) => m.count)).toEqual([8, 8, 11, 19, 5]);
    expect(plan.body.inputs).toMatchObject({ ticketNewMember: 68_951, renewalRateHistPct: 80.625, otherIncome: 10_800 });
  });

  it('alta de socio con pago dividido (membresía + movimiento + splits en una transacción)', async () => {
    const plans = await http.get('/api/v1/plans').set(auth(recepToken)).expect(200);
    planId = plans.body[0].id;
    const res = await http
      .post('/api/v1/members')
      .set(auth(recepToken))
      .send({
        firstName: 'Prueba',
        lastName: 'Integración',
        phone: '11 4000 1234',
        planId,
        initialPayment: {
          planId,
          paidOn: '2026-10-26',
          expiresOn: '2026-11-25',
          splits: [
            { method: 'CASH', amount: 20000 },
            { method: 'TRANSFER', amount: 25000 },
          ],
        },
      })
      .expect(201);
    expect(res.body.member).toMatchObject({ legacyCode: 'LB191', expiresAt: '2026-11-25', renewalStatus: 'OK', phoneE164: '+5491140001234' });
    expect(res.body.member.soldBy).toMatchObject({ displayName: 'Maru' });
    expect(res.body.membership).toMatchObject({ legacyCode: 'P0504', amountTotal: 45000 });
    expect(res.body.membership.splits).toHaveLength(2);

    const dup = await http
      .post('/api/v1/members')
      .set(auth(recepToken))
      .send({ firstName: 'PRUEBA', lastName: 'integracion', phone: '1140001234', planId })
      .expect(409);
    expect(dup.body).toMatchObject({ code: 'MEMBER_NAME_EXISTS', details: [expect.objectContaining({ value: 'LB191' })] });
  });

  it('caja filtrada: totales calculados en SQL sobre el mismo filtro (no sobre la página)', async () => {
    const all = await http.get('/api/v1/cash/movements?from=2026-10-01&to=2026-10-31&pageSize=100&expandSplits=true').set(auth(recepToken)).expect(200);
    const pages = Math.ceil(all.body.total / 100);
    let income = 0;
    let expense = 0;
    for (let p = 1; p <= pages; p++) {
      const page = await http.get(`/api/v1/cash/movements?from=2026-10-01&to=2026-10-31&pageSize=100&page=${p}`).set(auth(recepToken)).expect(200);
      for (const row of page.body.items) {
        if (row.type === 'INCOME') income += row.rowAmount;
        else expense += row.rowAmount;
      }
    }
    expect(all.body.totals.income).toBeCloseTo(income, 2);
    expect(all.body.totals.expense).toBeCloseTo(expense, 2);
    expect(all.body.totals.net).toBeCloseTo(income - expense, 2);
    expect(all.body.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });

    const one = await http.get('/api/v1/cash/movements?from=2026-10-01&to=2026-10-31&pageSize=1&type=INCOME&method=TRANSFER').set(auth(recepToken)).expect(200);
    expect(one.body.items).toHaveLength(1);
    expect(one.body.totals.expense).toBe(0);
    expect(one.body.totals.incomeByMethod).toEqual({ TRANSFER: one.body.totals.income });
    const byRegistrar = await http.get(`/api/v1/cash/movements?createdBy=${recepId}&from=2026-10-26&to=2026-10-26`).set(auth(recepToken)).expect(200);
    expect(byRegistrar.body.items.every((r: { audit: { createdBy: { id: string } } }) => r.audit.createdBy.id === recepId)).toBe(true);
    expect(byRegistrar.body.totals.income).toBe(45000);
    const summary = await http.get('/api/v1/cash/summary?from=2026-10-01&to=2026-10-31').set(auth(recepToken)).expect(200);
    expect(summary.body).toEqual(all.body.totals);
  });

  it('egreso con confirmPassword: 403 si no coincide (sin cerrar sesión) y 201 con la propia contraseña', async () => {
    const cats = await http.get('/api/v1/cash/categories?type=EXPENSE').set(auth(recepToken)).expect(200);
    const categoryId = cats.body[0].id;
    const body = { type: 'EXPENSE', categoryId, amount: 15000, splits: [{ method: 'CASH', amount: 15000 }], description: 'Compra de insumos de limpieza' };
    const wrong = await http.post('/api/v1/cash/movements').set(auth(recepToken)).send({ ...body, confirmPassword: newAdminPassword }).expect(403);
    expect(wrong.body.code).toBe('PASSWORD_CONFIRMATION_INVALID');
    await http.get('/api/v1/auth/me').set(auth(recepToken)).expect(200);
    const missing = await http.post('/api/v1/cash/movements').set(auth(recepToken)).send(body).expect(400);
    expect(missing.body.details.some((d: { field: string }) => d.field === 'confirmPassword')).toBe(true);
    const ok = await http.post('/api/v1/cash/movements').set(auth(recepToken)).send({ ...body, confirmPassword: newRecepPassword }).expect(201);
    expect(ok.body).toMatchObject({ type: 'EXPENSE', amount: 15000, legacyCode: 'MV0085', audit: { createdBy: { id: recepId } } });
    const audit = await http.get(`/api/v1/audit-logs?entity=CASH_MOVEMENT&entityId=${ok.body.id}`).set(auth(adminToken)).expect(200);
    expect(audit.body.items[0]).toMatchObject({ action: 'CREATE', passwordConfirmed: true, actorLabel: 'Mariel' });
    expect(JSON.stringify(audit.body)).not.toContain(newRecepPassword);
  });

  it('check-in duplicado el mismo día → 409 DUPLICATE_CHECKIN', async () => {
    const members = await http.get('/api/v1/members?q=prueba integracion').set(auth(recepToken)).expect(200);
    const memberId = members.body.items[0].id;
    await http.post('/api/v1/attendances').set(auth(recepToken)).send({ memberId }).expect(201);
    const dup = await http.post('/api/v1/attendances').set(auth(recepToken)).send({ memberId }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_CHECKIN');
    await http.post('/api/v1/attendances').set(auth(recepToken)).send({ memberId, force: true }).expect(201);
  });

  it('métricas: el mes en curso se calcula en vivo y la recuperación al arrancar reconstruye abril–septiembre', async () => {
    let renewalsByMonth: number[] = [];
    const live = await http.get('/api/v1/metrics/monthly').set(auth(adminToken)).expect(200);
    expect(live.body).toMatchObject({ period: '2026-10', source: 'LIVE', isCurrentMonth: true, isClosed: false, isReconstructed: true, cutoverPeriod: '2026-11' });
    expect(live.body.values.churn_pct.isProvisional).toBe(true);

    const recovery = await app.get(StartupRecoveryUseCase).execute();
    expect(recovery.closed.map((c) => `${c.period}:${c.stage}`)).toEqual([
      '2026-04:FINAL',
      '2026-05:FINAL',
      '2026-06:FINAL',
      '2026-07:FINAL',
      '2026-08:FINAL',
      '2026-09:FINAL',
    ]);

    const sept = await http.get('/api/v1/metrics/monthly?period=2026-09').set(auth(adminToken)).expect(200);
    expect(sept.body).toMatchObject({ source: 'SNAPSHOT', isClosed: true, isReconstructed: true, snapshot: { stage: 'FINAL', closedBy: 'system' } });
    // El backend debe coincidir con agregados SQL independientes sobre los mismos datos importados.
    const db = new PrismaClient();
    try {
      const [q] = await db.$queryRaw<
        { renewals: number; income_renewals: string; income_other: string; expenses: string; attendances: number; leads: number }[]
      >`SELECT
          (SELECT count(*)::int FROM memberships WHERE status = 'ACTIVE' AND starts_on BETWEEN '2026-09-01' AND '2026-09-30') AS renewals,
          (SELECT coalesce(sum(amount), 0)::text FROM cash_movements WHERE status = 'ACTIVE' AND type = 'INCOME' AND origin = 'RENEWAL'
             AND occurred_on BETWEEN '2026-09-01' AND '2026-09-30') AS income_renewals,
          (SELECT coalesce(sum(amount), 0)::text FROM cash_movements WHERE status = 'ACTIVE' AND type = 'INCOME' AND origin <> 'RENEWAL'
             AND occurred_on BETWEEN '2026-09-01' AND '2026-09-30') AS income_other,
          (SELECT coalesce(sum(amount), 0)::text FROM cash_movements WHERE status = 'ACTIVE' AND type = 'EXPENSE'
             AND occurred_on BETWEEN '2026-09-01' AND '2026-09-30') AS expenses,
          (SELECT count(*)::int FROM attendances WHERE status = 'ACTIVE' AND checked_in_on BETWEEN '2026-09-01' AND '2026-09-30') AS attendances,
          (SELECT count(*)::int FROM leads WHERE deleted_at IS NULL AND contacted_on BETWEEN '2026-09-01' AND '2026-09-30') AS leads`;
      expect(sept.body.values.renewals.value).toBe(q!.renewals);
      expect(sept.body.values.income_renewals.value).toBe(Number(q!.income_renewals));
      expect(sept.body.values.income_other.value).toBe(Number(q!.income_other));
      expect(sept.body.values.expenses_total.value).toBe(Number(q!.expenses));
      expect(sept.body.values.attendances_total.value).toBe(q!.attendances);
      expect(sept.body.values.leads_total.value).toBe(q!.leads);
      expect(sept.body.values.avg_ticket.value).toBe(Math.round(Number(q!.income_renewals) / q!.renewals));
      const monthly = await db.$queryRaw<{ m: string; n: number }[]>`
        SELECT to_char(starts_on, 'YYYY-MM') AS m, count(*)::int AS n FROM memberships
        WHERE status = 'ACTIVE' AND starts_on < '2026-10-01' GROUP BY 1 ORDER BY 1`;
      renewalsByMonth = monthly.map((r) => r.n);
    } finally {
      await db.$disconnect();
    }
    expect(sept.body.values.renewals.methodologyVersion).toBe('V1');
    expect(sept.body.previousPeriod).toBe('2026-08');
    expect(sept.body.values.renewals.delta).toMatchObject({
      absolute: sept.body.values.renewals.value - sept.body.previousValues.renewals.value,
    });

    // Reconstrucción de abril a septiembre = tabla de 03 §6b, métrica por métrica.
    const full = await http
      .get(`/api/v1/metrics/history?from=2026-04&to=2026-09&keys=${Object.keys(TABLE_6B).join(',')}`)
      .set(auth(adminToken))
      .expect(200);
    const reconstructed = Object.fromEntries(
      full.body.series.map((s: { key: string; points: { value: number | null }[] }) => [s.key, s.points.map((p) => p.value)]),
    );
    expect(reconstructed).toEqual(Object.fromEntries(Object.entries(TABLE_6B).map(([k, v]) => [k, v.slice(0, 6)])));
    expect(full.body.series[0].points.map((p: { period: string }) => p.period)).toEqual(PERIODS_6B.slice(0, 6));
    expect(
      full.body.series.every((s: { points: { source: string; isReconstructed: boolean }[] }) =>
        s.points.every((p) => p.source === 'SNAPSHOT' && p.isReconstructed),
      ),
    ).toBe(true);

    const history = await http.get('/api/v1/metrics/history?keys=renewals,churn_pct').set(auth(adminToken)).expect(200);
    const points = history.body.series[0].points;
    expect(points[0].period).toBe('2026-04');
    expect(points.every((p: { methodologyVersion: string }) => p.methodologyVersion === 'V1')).toBe(true);
    expect(points.map((p: { value: number }) => p.value).slice(0, 6)).toEqual(renewalsByMonth);

    const snaps = await http.get('/api/v1/metrics/snapshots').set(auth(adminToken)).expect(200);
    expect(snaps.body.filter((s: { stage: string }) => s.stage === 'REFERENCE')).toHaveLength(6);
    const months = await http.get('/api/v1/metrics/months').set(auth(adminToken)).expect(200);
    expect(months.body.periods[0]).toMatchObject({ period: '2026-10', isCurrentMonth: true, isClosed: false });

    const again = await http.post('/api/v1/metrics/close').set(auth(adminToken)).send({ period: '2026-09' }).expect(409);
    expect(again.body.code).toBe('PERIOD_ALREADY_CLOSED');
    const replaced = await http.post('/api/v1/metrics/close').set(auth(adminToken)).send({ period: '2026-09', replace: true }).expect(201);
    expect(replaced.body.snapshot).toMatchObject({ stage: 'FINAL', source: 'MANUAL', isCurrent: true });
    await http.post('/api/v1/metrics/close').set(auth(adminToken)).send({ period: '2026-10' }).expect(409);
  });
});
