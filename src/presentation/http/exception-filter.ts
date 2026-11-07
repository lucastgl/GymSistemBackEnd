import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, DomainErrorKind, ErrorCodes, ErrorDetail } from '../../domain/shared/errors';
import { AppRequest } from './http-context';

/** ErrorResponse de docs/05. */
export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details: ErrorDetail[];
  requestId: string | null;
}

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  VALIDATION: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
};

const CODE_BY_STATUS: Record<number, string> = {
  400: ErrorCodes.VALIDATION_ERROR,
  401: ErrorCodes.UNAUTHORIZED,
  403: ErrorCodes.FORBIDDEN,
  404: ErrorCodes.NOT_FOUND,
  409: ErrorCodes.CONFLICT,
  429: ErrorCodes.TOO_MANY_ATTEMPTS,
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'La solicitud no es válida',
  401: 'Sesión requerida',
  403: 'No tenés permisos para esta operación',
  404: 'Recurso inexistente',
  409: 'Conflicto con el estado actual',
  413: 'La solicitud es demasiado grande',
  429: 'Demasiados intentos',
};

/** Traduce errores de dominio, de Nest y de la base a `ErrorResponse` con código estable. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AppRequest>();
    const body = this.toBody(exception, req?.requestId ?? null);
    if (body.statusCode >= 500) {
      const err = exception as Error;
      this.logger.error(`${req?.method} ${req?.originalUrl} [${body.requestId}] ${err?.message}`, err?.stack);
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, requestId: string | null): ErrorResponseBody {
    if (exception instanceof DomainError) {
      return {
        statusCode: STATUS_BY_KIND[exception.kind],
        code: exception.code,
        message: exception.message,
        details: exception.details,
        requestId,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const p = payload as Partial<ErrorResponseBody>;
        return {
          statusCode: status,
          code: String(p.code),
          message: p.message ?? MESSAGE_BY_STATUS[status] ?? 'Error',
          details: p.details ?? [],
          requestId,
        };
      }
      return {
        statusCode: status,
        code: CODE_BY_STATUS[status] ?? `HTTP_${status}`,
        message: MESSAGE_BY_STATUS[status] ?? exception.message,
        details: [],
        requestId,
      };
    }
    // Errores de Prisma por duck typing (presentación no importa @prisma/client).
    const prismaCode = (exception as { code?: unknown })?.code;
    if (prismaCode === 'P2002') {
      return { statusCode: 409, code: ErrorCodes.CONFLICT, message: 'Ya existe un registro con esos datos', details: [], requestId };
    }
    if (prismaCode === 'P2025') {
      return { statusCode: 404, code: ErrorCodes.NOT_FOUND, message: 'Recurso inexistente', details: [], requestId };
    }
    if (prismaCode === 'P2028' || prismaCode === 'P2034') {
      return { statusCode: 409, code: ErrorCodes.CONFLICT, message: 'Operación concurrente: reintentá en unos segundos', details: [], requestId };
    }
    return { statusCode: 500, code: ErrorCodes.INTERNAL_ERROR, message: 'Error interno del servidor', details: [], requestId };
  }
}
