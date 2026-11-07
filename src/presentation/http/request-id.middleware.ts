import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppRequest } from './http-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Asigna un `requestId` (UUID, se guarda en audit_logs.request_id) y lo devuelve en `X-Request-Id`. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && UUID_RE.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
