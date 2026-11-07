import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, registerDecorator, ValidationOptions } from 'class-validator';
import { DateOnly } from '../../domain/shared/date-only';
import { Period } from '../../domain/shared/period';

/** `YYYY-MM-DD` real (format: date de docs/05). */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) =>
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'Fecha inválida (AAAA-MM-DD)', ...options },
      validator: { validate: (v: unknown) => DateOnly.isValid(v) },
    });
}

/** `YYYY-MM` (pattern ^\d{4}-\d{2}$ de docs/05). */
export function IsPeriod(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) =>
    registerDecorator({
      name: 'isPeriod',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: 'Período inválido (AAAA-MM)', ...options },
      validator: { validate: (v: unknown) => Period.isValid(v) },
    });
}

/** Booleano de query string ("true"/"false"). */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
  });

/** Lista `style: form, explode: false` ("A,B") o parámetro repetido. */
export const ToArray = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const list = Array.isArray(value) ? value : [value];
    return list.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
  });

export const ToTrimmedString = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Parámetros `page` y `pageSize` (1..100, default 25). */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Parámetro `period` (YYYY-MM, default mes actual). */
export class PeriodQueryDto {
  @IsOptional()
  @IsPeriod()
  period?: string;
}
