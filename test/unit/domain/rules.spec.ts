import { attendanceRisk, suggestedTemplate } from '../../../src/domain/attendances/attendance-risk';
import { computeChangedFields, sanitizeForAudit } from '../../../src/domain/audit/audit-entry';
import { passwordPolicyViolations } from '../../../src/domain/auth/password-policy';
import { validateSplits } from '../../../src/domain/cash/splits';
import { selectAutoCancellations, shouldAutoCancel } from '../../../src/domain/members/auto-cancel';
import { reactivationDate, statusAt } from '../../../src/domain/members/member-status';
import { isUpToDate, renewalStatus } from '../../../src/domain/members/renewal-status';
import { buildWhatsappLink } from '../../../src/domain/members/whatsapp';
import { deriveMemberRenewalFields, pickCurrentMembership } from '../../../src/domain/memberships/membership-rules';
import { planPendingCloses } from '../../../src/domain/metrics/close-planning';
import { BusinessSettings, validateSettingValue } from '../../../src/domain/settings/business-settings';
import { DateOnly } from '../../../src/domain/shared/date-only';
import { DomainError } from '../../../src/domain/shared/errors';
import { Period } from '../../../src/domain/shared/period';
import { PhoneNumber } from '../../../src/domain/shared/phone-number';
import { normalizePaymentMethod, normalizeSearchQuery, searchName } from '../../../src/domain/shared/text';

const D = (s: string) => s as DateOnly;
const today = D('2026-10-26');

describe('renewalStatus (03 §5)', () => {
  const active = (expiresAt: string | null) => ({ status: 'ACTIVE' as const, expiresAt: expiresAt as DateOnly | null });

  it.each([
    ['2026-10-25', 'EXPIRED'],
    ['2026-10-26', 'DUE_TODAY'],
    ['2026-10-27', 'DUE_3D'],
    ['2026-10-29', 'DUE_3D'],
    ['2026-10-30', 'DUE_7D'],
    ['2026-11-02', 'DUE_7D'],
    ['2026-11-03', 'OK'],
  ])('vencimiento %s → %s', (expires, expected) => {
    expect(renewalStatus(active(expires), today)).toBe(expected);
  });

  it('sin vencimiento es UNKNOWN y un socio de baja es CANCELLED aunque esté al día', () => {
    expect(renewalStatus(active(null), today)).toBe('UNKNOWN');
    expect(renewalStatus({ status: 'CANCELLED', expiresAt: D('2026-12-01') }, today)).toBe('CANCELLED');
  });

  it('respeta umbrales configurables de renewal.warn_days', () => {
    expect(renewalStatus(active('2026-10-31'), today, { due3d: 5, due7d: 10 })).toBe('DUE_3D');
  });

  it('cuota al día = OK + DUE_7D + DUE_3D + DUE_TODAY', () => {
    expect(['OK', 'DUE_7D', 'DUE_3D', 'DUE_TODAY'].every((s) => isUpToDate(s as never))).toBe(true);
    expect(isUpToDate('EXPIRED')).toBe(false);
    expect(isUpToDate('UNKNOWN')).toBe(false);
  });
});

describe('attendanceRisk (03 §5)', () => {
  const joinedAt = D('2026-10-01');
  it.each([
    ['2026-10-19', 'OK', 7],
    ['2026-10-18', 'MEDIUM', 8],
    ['2026-10-12', 'MEDIUM', 14],
    ['2026-10-11', 'HIGH', 15],
    ['2026-10-06', 'HIGH', 20],
    ['2026-10-05', 'CRITICAL', 21],
  ])('última asistencia %s → %s (%d días)', (last, risk, days) => {
    const r = attendanceRisk({ lastAttendanceOn: D(last), joinedAt }, today);
    expect(r).toEqual({ risk, daysSinceLastAttendance: days, neverAttended: false });
  });

  it('sin asistencias → NO_ATTENDANCE con días desde el alta (antes daba OK con 0 días)', () => {
    expect(attendanceRisk({ lastAttendanceOn: null, joinedAt }, today)).toEqual({
      risk: 'NO_ATTENDANCE',
      daysSinceLastAttendance: 25,
      neverAttended: true,
    });
  });

  it('plantilla sugerida por riesgo', () => {
    expect(suggestedTemplate('CRITICAL')).toBe('inasistencia_critica');
    expect(suggestedTemplate('HIGH')).toBe('inasistencia_alta');
    expect(suggestedTemplate('MEDIUM')).toBe('ausente');
  });
});

describe('normalizaciones (04 §6)', () => {
  it('search_name: sin acentos, minúsculas y espacios colapsados', () => {
    expect(searchName('  José  María', 'Pérez   Núñez ')).toBe('jose maria perez nunez');
    expect(normalizeSearchQuery('  PÉREZ ')).toBe('perez');
    expect(normalizeSearchQuery('   ')).toBeNull();
  });

  it.each([
    ['11 5859-3977', '+5491158593977'],
    ['+54 9 11 5859 3977', '+5491158593977'],
    ['54 11 5859 3977', '+5491158593977'],
    ['011 5859 3977', '+5491158593977'],
    ['2645 123456', '+5492645123456'],
    ['5859 3977', '+5491158593977'],
  ])('teléfono %s → %s', (raw, e164) => {
    const p = PhoneNumber.parse(raw);
    expect(p.e164).toBe(e164);
    expect(p.needsReview).toBe(false);
    expect(p.raw).toBe(raw);
  });

  it('teléfono no normalizable queda para revisar; vacío no', () => {
    const bad = PhoneNumber.parse('12345');
    expect(bad.e164).toBeNull();
    expect(bad.needsReview).toBe(true);
    const empty = PhoneNumber.parse('   ');
    expect(empty.raw).toBeNull();
    expect(empty.needsReview).toBe(false);
  });

  it.each([
    ['MP', 'MERCADOPAGO'],
    ['mercado  pago', 'MERCADOPAGO'],
    ['Mercado-Pago', 'MERCADOPAGO'],
    ['Efectivo', 'CASH'],
    ['transferencia', 'TRANSFER'],
    ['Débito', 'DEBIT'],
    ['credito', 'CREDIT'],
    ['Otros', 'OTHER'],
  ])('método de pago %s → %s', (raw, method) => {
    expect(normalizePaymentMethod(raw)).toBe(method);
  });

  it('método desconocido → null', () => {
    expect(normalizePaymentMethod('cheque')).toBeNull();
  });
});

describe('baja automática (HU-SOC-05)', () => {
  const base = { id: 'x', status: 'ACTIVE' as const, deletedAt: null };
  it('se aplica con MÁS de N días vencido (día vencimiento + N + 1)', () => {
    expect(shouldAutoCancel({ ...base, expiresAt: D('2026-10-11') }, today, 15)).toBe(false); // 15 días
    expect(shouldAutoCancel({ ...base, expiresAt: D('2026-10-10') }, today, 15)).toBe(true); // 16 días
  });

  it('no aplica a socios de baja, anulados o sin vencimiento', () => {
    expect(shouldAutoCancel({ ...base, status: 'CANCELLED', expiresAt: D('2026-01-01') }, today, 15)).toBe(false);
    expect(shouldAutoCancel({ ...base, deletedAt: new Date(), expiresAt: D('2026-01-01') }, today, 15)).toBe(false);
    expect(shouldAutoCancel({ ...base, expiresAt: null }, today, 15)).toBe(false);
  });

  it('el umbral sale del parámetro (p. ej. 35 días)', () => {
    const list = [
      { ...base, id: 'a', expiresAt: D('2026-09-30') },
      { ...base, id: 'b', expiresAt: D('2026-09-20') },
    ];
    expect(selectAutoCancellations(list, today, 15).map((m) => m.id)).toEqual(['a', 'b']);
    expect(selectAutoCancellations(list, today, 35).map((m) => m.id)).toEqual(['b']);
  });
});

describe('splits (HU-REN-01)', () => {
  it('acepta métodos distintos que suman el total', () => {
    const r = validateSplits([{ method: 'CASH', amount: 10000.5 }, { method: 'TRANSFER', amount: 29999.5 }], 40000);
    expect(r.total.toNumber()).toBe(40000);
    expect(r.splits.map((s) => s.method)).toEqual(['CASH', 'TRANSFER']);
  });

  it('rechaza métodos repetidos', () => {
    expect(() => validateSplits([{ method: 'CASH', amount: 1 }, { method: 'CASH', amount: 2 }], 3)).toThrow(DomainError);
  });

  it('rechaza si la suma no coincide con el total', () => {
    expect(() => validateSplits([{ method: 'CASH', amount: 100 }, { method: 'DEBIT', amount: 50 }], 151)).toThrow(
      /suma de los métodos/,
    );
  });

  it('rechaza montos no positivos, más de 2 decimales, lista vacía o más de 4 métodos', () => {
    expect(() => validateSplits([{ method: 'CASH', amount: 0 }])).toThrow(DomainError);
    expect(() => validateSplits([{ method: 'CASH', amount: 1.005 }])).toThrow(DomainError);
    expect(() => validateSplits([])).toThrow(DomainError);
    const five = (['CASH', 'TRANSFER', 'MERCADOPAGO', 'DEBIT', 'CREDIT'] as const).map((method) => ({ method, amount: 1 }));
    expect(() => validateSplits(five)).toThrow(DomainError);
  });
});

describe('membresía vigente y campos del socio (04 §4 regla 4)', () => {
  const m = (id: string, startsOn: string, expiresOn: string, status: 'ACTIVE' | 'VOIDED' = 'ACTIVE', createdAt = '2026-01-01T00:00:00Z') => ({
    id,
    status,
    planId: `plan-${id}`,
    startsOn: D(startsOn),
    expiresOn: D(expiresOn),
    createdAt: new Date(createdAt),
  });

  it('elige la ACTIVE más reciente por starts_on y desempata por created_at', () => {
    const list = [m('a', '2026-08-01', '2026-08-31'), m('b', '2026-09-01', '2026-09-30', 'VOIDED'), m('c', '2026-08-01', '2026-09-15', 'ACTIVE', '2026-08-02T00:00:00Z')];
    expect(pickCurrentMembership(list)?.id).toBe('c');
  });

  it('sin membresías activas: vencimiento y última renovación nulos, plan sin cambios', () => {
    expect(deriveMemberRenewalFields([m('a', '2026-08-01', '2026-08-31', 'VOIDED')])).toEqual({
      lastRenewalAt: null,
      expiresAt: null,
      currentPlanId: undefined,
    });
  });
});

describe('estado por eventos (03 §1)', () => {
  const ev = (type: 'CANCELLED' | 'AUTO_CANCELLED' | 'REACTIVATED', on: string, seq: number) => ({ type, effectiveOn: D(on), seq });
  it('status_at usa el último evento con effective_on ≤ d', () => {
    const events = [ev('AUTO_CANCELLED', '2026-05-10', 1), ev('REACTIVATED', '2026-06-02', 2)];
    expect(statusAt(events, D('2026-05-09'))).toBe('ACTIVE');
    expect(statusAt(events, D('2026-05-31'))).toBe('CANCELLED');
    expect(statusAt(events, D('2026-06-30'))).toBe('ACTIVE');
    expect(statusAt([], D('2026-06-30'))).toBe('ACTIVE');
  });

  it('una reactivación por renovación retroactiva no queda antes de la baja', () => {
    expect(reactivationDate(D('2026-10-01'), D('2026-10-20'))).toBe('2026-10-20');
    expect(reactivationDate(D('2026-10-25'), D('2026-10-20'))).toBe('2026-10-25');
  });
});

describe('política de contraseña (HU-AUTH-02)', () => {
  it('exige ≥10, letra, número y distinta de la actual', () => {
    expect(passwordPolicyViolations('corta1')).toHaveLength(1);
    expect(passwordPolicyViolations('sinnumerosaqui')).toEqual(['Debe incluir al menos un número']);
    expect(passwordPolicyViolations('1234567890')).toEqual(['Debe incluir al menos una letra']);
    expect(passwordPolicyViolations('Valida12345', 'Valida12345')).toEqual(['Debe ser distinta de la contraseña actual']);
    expect(passwordPolicyViolations('Valida12345', 'Otra1234567')).toEqual([]);
  });
});

describe('auditoría', () => {
  it('nunca guarda hashes, tokens ni contraseñas (en ningún nivel)', () => {
    const clean = sanitizeForAudit({
      email: 'a@b.c',
      passwordHash: '$argon2id$...',
      confirmPassword: 'secreta',
      nested: { refreshToken: 'x', token_hash: 'y', ok: 1 },
      when: new Date('2026-10-26T12:00:00Z'),
    });
    expect(clean).toEqual({ email: 'a@b.c', nested: { ok: 1 }, when: '2026-10-26T12:00:00.000Z' });
  });

  it('changedFields compara antes y después', () => {
    expect(computeChangedFields({ a: 1, b: [1], c: null }, { a: 1, b: [2], c: 'x' })).toEqual(['b', 'c']);
    expect(computeChangedFields(null, { a: 1, b: null })).toEqual(['a']);
  });
});

describe('WhatsApp (HU-SOC-06)', () => {
  it('arma wa.me con E.164 sin + y la plantilla con el primer nombre', () => {
    const link = buildWhatsappLink(PhoneNumber.parse('11 5859 3977'), 'Juan Carlos', 'Hola {nombre}! Tu cuota vence.');
    expect(link.message).toBe('Hola Juan! Tu cuota vence.');
    expect(link.url).toBe(`https://wa.me/5491158593977?text=${encodeURIComponent('Hola Juan! Tu cuota vence.')}`);
  });

  it('sin teléfono válido → 409 MEMBER_PHONE_INVALID', () => {
    expect(() => buildWhatsappLink(PhoneNumber.parse('123'), 'Ana', 'x')).toThrow(expect.objectContaining({ code: 'MEMBER_PHONE_INVALID' }));
  });
});

describe('planificación de cierres (03 §0 regla 5 y §6b)', () => {
  const schedule = { graceDays: 15, autoCloseTime: '23:59', finalCloseTime: '00:05' };
  const first = '2026-04' as Period;

  it('al arrancar el 26/10/2026 reconstruye abril–septiembre como FINAL y no toca octubre', () => {
    const plan = planPendingCloses({ firstPeriod: first, today, timeHHmm: '10:00', schedule, currentStages: new Map() });
    expect(plan).toEqual(
      ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((period) => ({ period, stage: 'FINAL', replaces: false })),
    );
  });

  it('el 31/10 a las 23:59 cierra octubre preliminar y el 16/11 00:05 lo reemplaza por el definitivo', () => {
    const closed = new Map<string, 'PRELIMINARY' | 'FINAL'>(
      ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((p) => [p, 'FINAL']),
    );
    expect(planPendingCloses({ firstPeriod: first, today: D('2026-10-31'), timeHHmm: '23:58', schedule, currentStages: closed })).toEqual([]);
    expect(planPendingCloses({ firstPeriod: first, today: D('2026-10-31'), timeHHmm: '23:59', schedule, currentStages: closed })).toEqual([
      { period: '2026-10', stage: 'PRELIMINARY', replaces: false },
    ]);
    closed.set('2026-10', 'PRELIMINARY');
    expect(planPendingCloses({ firstPeriod: first, today: D('2026-11-16'), timeHHmm: '00:04', schedule, currentStages: closed })).toEqual([]);
    expect(planPendingCloses({ firstPeriod: first, today: D('2026-11-16'), timeHHmm: '00:05', schedule, currentStages: closed })).toEqual([
      { period: '2026-10', stage: 'FINAL', replaces: true },
    ]);
  });

  it('si el servidor estuvo apagado, un mes pendiente dentro de la gracia queda PRELIMINARY', () => {
    const closed = new Map<string, 'PRELIMINARY' | 'FINAL'>([['2026-04', 'FINAL']]);
    const plan = planPendingCloses({ firstPeriod: D('2026-04-01').slice(0, 7) as Period, today: D('2026-06-10'), timeHHmm: '09:00', schedule, currentStages: closed });
    expect(plan).toEqual([{ period: '2026-05', stage: 'PRELIMINARY', replaces: false }]);
  });
});

describe('parámetros', () => {
  it('lee con defaults y valida tipos al editar', () => {
    const s = new BusinessSettings({ 'members.auto_cancel_after_days': 35, 'renewal.warn_days': 'no-es-lista' });
    expect(s.autoCancelAfterDays).toBe(35);
    expect(s.renewalWarnDays).toEqual({ due3d: 3, due7d: 7 });
    expect(s.cutoverPeriod).toBe('2026-11');
    expect(() => validateSettingValue('members.auto_cancel_after_days', 'number', '15')).toThrow(DomainError);
    expect(() => validateSettingValue('attendance.alert_days', 'array', [14, 7, 20])).toThrow(DomainError);
    expect(validateSettingValue('finance.market_rent', 'number', 1200000)).toBe(1200000);
  });
});

describe('DateOnly y Period', () => {
  it('aritmética de fechas calendario', () => {
    expect(DateOnly.addDays(D('2026-02-28'), 1)).toBe('2026-03-01');
    expect(DateOnly.diffDays(D('2026-10-01'), D('2026-10-26'))).toBe(25);
    expect(DateOnly.isValid('2026-02-30')).toBe(false);
    expect(Period.last('2026-02' as Period)).toBe('2026-02-28');
    expect(Period.previous('2026-01' as Period)).toBe('2025-12');
    expect(Period.range('2026-11' as Period, '2027-02' as Period)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});
