import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { Clock } from '../../domain/ports/ports';
import { DateOnly } from '../../domain/shared/date-only';

export const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Reloj del negocio: fechas calendario y horas en la zona configurada (`app.timezone`). */
export class BusinessClock implements Clock {
  constructor(private zone: string = DEFAULT_TIME_ZONE) {}

  setTimeZone(zone: string): void {
    this.zone = zone;
  }

  timeZone(): string {
    return this.zone;
  }

  now(): Date {
    return new Date();
  }

  today(): DateOnly {
    return this.businessDateOf(this.now());
  }

  timeOfDay(): string {
    return formatInTimeZone(this.now(), this.zone, 'HH:mm');
  }

  businessDateOf(instant: Date): DateOnly {
    return formatInTimeZone(instant, this.zone, 'yyyy-MM-dd') as DateOnly;
  }

  instantOf(date: DateOnly, timeHHmm: string): Date {
    return fromZonedTime(`${date}T${timeHHmm}:00`, this.zone);
  }
}

/** Reloj fijo para pruebas e2e (`FIXED_NOW`): mismo comportamiento con un instante congelado. */
export class FixedClock extends BusinessClock {
  constructor(
    private readonly instant: Date,
    zone: string = DEFAULT_TIME_ZONE,
  ) {
    super(zone);
  }

  override now(): Date {
    return new Date(this.instant.getTime());
  }
}
