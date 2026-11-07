import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from '../infrastructure/config/app-config';
import { loadOpenApiDocument } from '../infrastructure/contract/contract-files';
import { RequestIdMiddleware } from '../presentation/http/request-id.middleware';

export const GLOBAL_PREFIX = 'api/v1';

/** Configuración HTTP compartida por `main.ts` y las pruebas e2e. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  if (config.trustProxy) express.set('trust proxy', true);
  express.disable('x-powered-by');
  const requestId = new RequestIdMiddleware();
  app.use(requestId.use.bind(requestId));
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  // Swagger UI sirve el contrato tal cual (contract/openapi.yaml, copia de docs/05-api-openapi.yaml).
  SwaggerModule.setup('api/docs', app, loadOpenApiDocument() as unknown as OpenAPIObject, {
    customSiteTitle: 'Limit Breaker API · contrato',
  });
}
