import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorDetail, ErrorCodes } from '../../domain/shared/errors';

const MESSAGES: Record<string, string> = {
  isDefined: 'Es obligatorio',
  isNotEmpty: 'Es obligatorio',
  isString: 'Debe ser texto',
  isEmail: 'Email inválido',
  isUUID: 'Debe ser un UUID válido',
  isIn: 'Valor no permitido',
  isEnum: 'Valor no permitido',
  isInt: 'Debe ser un número entero',
  isNumber: 'Debe ser un número con hasta 2 decimales',
  isPositive: 'Debe ser mayor a 0',
  min: 'Es menor al mínimo permitido',
  max: 'Es mayor al máximo permitido',
  minLength: 'Es demasiado corto',
  maxLength: 'Es demasiado largo',
  isBoolean: 'Debe ser verdadero o falso',
  isISO8601: 'Fecha y hora inválidas (ISO 8601)',
  isDateOnly: 'Fecha inválida (AAAA-MM-DD)',
  isPeriod: 'Período inválido (AAAA-MM)',
  matches: 'Formato inválido',
  isArray: 'Debe ser una lista',
  arrayMinSize: 'La lista tiene menos elementos de los requeridos',
  arrayMaxSize: 'La lista tiene más elementos de los permitidos',
  isObject: 'Debe ser un objeto',
  whitelistValidation: 'Campo no permitido',
};

function flatten(errors: ValidationError[], parent = ''): ErrorDetail[] {
  const out: ErrorDetail[] = [];
  for (const e of errors) {
    const isIndex = /^\d+$/.test(e.property);
    const field = parent ? (isIndex ? `${parent}[${e.property}]` : `${parent}.${e.property}`) : e.property;
    if (e.constraints) {
      for (const [key, raw] of Object.entries(e.constraints)) {
        // Si el DTO trae un mensaje propio en español se usa; si no, el genérico por restricción.
        const custom = raw && !/^(each value in )?\S+ (must|should)/i.test(raw) && !raw.startsWith('property ');
        out.push({ field, message: custom ? raw : (MESSAGES[key] ?? 'Valor inválido'), value: e.value });
      }
    }
    if (e.children && e.children.length > 0) out.push(...flatten(e.children, field));
  }
  return out;
}

/** ValidationPipe global: DTOs estrictos (sin campos extra) y `VALIDATION_ERROR` con `details[]` por campo. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: true },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        statusCode: 400,
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Hay datos inválidos en la solicitud',
        details: flatten(errors),
      }),
  });
}
