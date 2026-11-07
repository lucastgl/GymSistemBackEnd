import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './composition/app.module';
import { configureApp, GLOBAL_PREFIX } from './composition/configure-app';
import { loadAppConfig } from './infrastructure/config/app-config';

async function bootstrap(): Promise<void> {
  try {
    process.loadEnvFile(); // .env del directorio actual (Node 22); en producción alcanza con variables de entorno
  } catch {
    // sin .env: se usan las variables de entorno del proceso
  }
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  const logger = new Logger('Bootstrap');
  logger.log(`API escuchando en http://localhost:${config.port}/${GLOBAL_PREFIX}`);
  logger.log(`Contrato (Swagger UI) en http://localhost:${config.port}/api/docs`);
}

void bootstrap();
