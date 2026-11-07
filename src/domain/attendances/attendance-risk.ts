import { DateOnly } from '../shared/date-only';
import { AttendanceRisk, WhatsappTemplate } from '../shared/enums';

/** Umbrales `attendance.alert_days` ([7, 14, 20]). */
export interface AttendanceThresholds {
  medium: number;
  high: number;
  critical: number;
}

export const DEFAULT_ATTENDANCE_THRESHOLDS: AttendanceThresholds = { medium: 7, high: 14, critical: 20 };

export interface AttendanceRiskResult {
  risk: AttendanceRisk;
  /** Días calendario desde la última asistencia; si nunca vino, desde el alta. */
  daysSinceLastAttendance: number;
  neverAttended: boolean;
}

/**
 * Riesgo de inasistencia (03 §5, `clasificarRiesgoInasist_`) con el cambio V1:
 * sin asistencias registradas → NO_ATTENDANCE (antes contaba 0 días y daba OK).
 * CRITICAL > 20, HIGH > 14, MEDIUM > 7, OK ≤ 7.
 */
export function attendanceRisk(
  input: { lastAttendanceOn: DateOnly | null; joinedAt: DateOnly },
  today: DateOnly,
  thresholds: AttendanceThresholds = DEFAULT_ATTENDANCE_THRESHOLDS,
): AttendanceRiskResult {
  if (input.lastAttendanceOn === null) {
    return {
      risk: 'NO_ATTENDANCE',
      daysSinceLastAttendance: Math.max(0, DateOnly.diffDays(input.joinedAt, today)),
      neverAttended: true,
    };
  }
  const days = Math.max(0, DateOnly.diffDays(input.lastAttendanceOn, today));
  let risk: AttendanceRisk = 'OK';
  if (days > thresholds.critical) risk = 'CRITICAL';
  else if (days > thresholds.high) risk = 'HIGH';
  else if (days > thresholds.medium) risk = 'MEDIUM';
  return { risk, daysSinceLastAttendance: days, neverAttended: false };
}

/** Orden "riesgo desc" de GET /attendances/risk. */
export const RISK_PRIORITY: readonly AttendanceRisk[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'NO_ATTENDANCE', 'OK'];

/** Plantilla de WhatsApp sugerida para cada nivel de riesgo. */
export function suggestedTemplate(risk: AttendanceRisk): Extract<
  WhatsappTemplate,
  'ausente' | 'inasistencia_alta' | 'inasistencia_critica'
> {
  if (risk === 'CRITICAL') return 'inasistencia_critica';
  if (risk === 'HIGH') return 'inasistencia_alta';
  return 'ausente';
}
