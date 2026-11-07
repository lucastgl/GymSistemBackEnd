# Limit Breaker · API (NestJS)

Backend del sistema de gestión del gimnasio Limit Breaker. Reemplaza al Google Sheets + Apps Script del sistema anterior. Expone la API `/api/v1` que consume el frontend Next.js (`../limit-breaker-web`), con autenticación propia (JWT), autorización por rol, auditoría transaccional, métricas V1 con cierres de mes automáticos y procesos programados.

- **Stack:** NestJS 11 · TypeScript `strict` · Prisma 6.19.3 · PostgreSQL (Supabase usado solo como base de datos) · `@node-rs/argon2` · `@nestjs/jwt` · `@nestjs/schedule` · `date-fns-tz` · Jest.
- **Contrato:** la fuente de verdad es `../docs/05-api-openapi.yaml` (57 rutas, 73 operaciones). Este repo sirve una copia en `contract/` (ver [Contrato y Swagger](#contrato-y-swagger)).
- **Decisiones y desvíos de la Fase 2:** [`../docs/fase2-observaciones-backend.md`](../docs/fase2-observaciones-backend.md). **Fase 4 (equipo, "Vendido por", objetivos y bonos):** [`../docs/fase4-observaciones-backend.md`](../docs/fase4-observaciones-backend.md).

## Requisitos

- Node.js **22 o superior** (probado con 22.16) y npm **11** (probado con 11.16).
- Una base PostgreSQL creada con los scripts de [`../sql`](../sql/README.md) (Supabase en producción, Docker para probar en local).
- Docker, solo para la prueba de integración local (opcional).

## Instalación

```bash
npm ci            # instala las versiones exactas del package-lock.json
```

`postinstall` ejecuta `prisma generate` (genera el cliente desde `prisma/schema.prisma`). Todas las dependencias están fijadas a una versión exacta en `package.json`.

### Scripts de instalación de npm 11

npm 11 controla qué dependencias pueden ejecutar scripts de instalación con el campo `allowScripts` de `package.json`. Ya quedaron registrados con `npm approve-scripts`:

| Paquete | Decisión | Por qué |
|---|---|---|
| `prisma@6.19.3`, `@prisma/engines@6.19.3`, `@prisma/client@6.19.3` | aprobado | Descargan el motor de Prisma y generan el cliente. Sin esto la API no compila. |
| `@scarf/scarf` | denegado | Telemetría opcional que trae `swagger-ui-dist`; no hace falta. |

Si al instalar npm avisa que hay scripts sin revisar (por ejemplo, después de actualizar una dependencia):

```bash
npm approve-scripts --allow-scripts-pending          # lista los pendientes, no modifica nada
npm approve-scripts prisma @prisma/client @prisma/engines
npm deny-scripts @scarf/scarf
npm rebuild prisma @prisma/client @prisma/engines    # vuelve a correr los scripts aprobados
```

Las aprobaciones quedan fijadas a la versión instalada (`pkg@versión`). Al actualizar Prisma hay que volver a aprobar.

## Variables de entorno

Copiá `.env.example` a `.env` y completalo. `npm start` carga `.env` del directorio actual (`process.loadEnvFile`); en producción alcanza con variables de entorno del proceso.

| Variable | Obligatoria | Default | Uso |
|---|---|---|---|
| `DATABASE_URL` | sí | — | Pooler de Supabase (puerto **6543**) con `?pgbouncer=true&connection_limit=1`. |
| `DIRECT_URL` | sí (Prisma la exige en el esquema) | — | Conexión directa (5432). Solo para herramientas de Prisma; la app no migra. |
| `JWT_ACCESS_SECRET` | sí | — | Secreto HS256 del access token, mínimo 32 caracteres. |
| `JWT_ACCESS_TTL_SECONDS` | no | `900` | Vida del access token (15 min). |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | Vida del refresh token (rotativo). |
| `PORT` | no | `3000` | Puerto HTTP. |
| `CORS_ORIGIN` | no | `http://localhost:3001` | Orígenes permitidos, separados por coma. |
| `TRUST_PROXY` | no | `false` | `true` detrás de un proxy, para registrar la IP real en auditoría. |
| `JOBS_ENABLED` | no | `true` | Programa los procesos automáticos y la recuperación al arrancar. |
| `FIXED_NOW` | no | vacío | Solo pruebas: congela el reloj del negocio (ISO 8601). |

Los parámetros del negocio (días de gracia, umbrales, costos fijos, metas, límite de intentos, etc.) **no** son variables de entorno: viven en la tabla `settings` y se editan con `PATCH /settings` (ADMIN).

## Base de datos

La base **no** la crea este backend. Se crea ejecutando a mano, en orden, los scripts de [`../sql`](../sql/README.md) (esquema, complementos, usuarios iniciales e importación histórica). Este proyecto no ejecuta `prisma migrate`: solo usa `prisma generate`. `prisma/schema.prisma` es la fuente del esquema y no se modifica desde acá.

## Credenciales iniciales

- Las contraseñas temporales de los usuarios iniciales (1 ADMIN, 2 RECEPCIONISTA, 1 NUTRICIONISTA) las genera `sql/tools` y quedan en **`../sql/.env`** (claves `SEED_*_EMAIL` y `SEED_*_PASSWORD`). Nunca están en el código ni en los logs, y ese archivo no se versiona.
- En el **primer login** la API responde `mustChangePassword: true` y bloquea cualquier ruta fuera de `/auth/*` con `403 PASSWORD_CHANGE_REQUIRED` hasta que el usuario cambie su contraseña (`POST /auth/change-password`: mínimo 10 caracteres, al menos una letra y un número, distinta de la actual).
- Un ADMIN puede generar una nueva contraseña temporal con `POST /users/{id}/reset-password`: se devuelve una sola vez, revoca las sesiones del usuario y vuelve a exigir el cambio.
- Los hashes son argon2id en formato PHC con los parámetros por defecto de `@node-rs/argon2` 2.2.2, la misma librería y versión que usa `sql/tools`. La prueba de integración inicia sesión con las contraseñas de `../sql/.env` para comprobarlo.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila a `dist/` (`nest build`). |
| `npm start` | Levanta `dist/main.js` (carga `.env` si existe). |
| `npm run start:dev` | Modo desarrollo con recarga. |
| `npm run lint` | ESLint, incluidas las reglas de límites de capa. Falla ante cualquier violación. |
| `npm test` | Tests unitarios del dominio, de casos de uso (repositorios en memoria) y de arquitectura (capas y contrato). |
| `npm run test:integration` | Levanta PostgreSQL 16 en Docker, aplica `../sql`, corre las pruebas e2e y baja el contenedor. |
| `npm run contract:sync` | Copia `../docs/05-api-openapi.yaml` y `../docs/06-etiquetas.json` a `contract/`. |
| `npm run prisma:generate` | Regenera el cliente de Prisma. |

## Contrato y Swagger

- `contract/openapi.yaml` es una copia de `../docs/05-api-openapi.yaml` y `contract/labels.json` de `../docs/06-etiquetas.json`. **La fuente es `docs/`**: si cambia el contrato, se edita en `docs/` y se corre `npm run contract:sync`.
- Swagger UI sirve ese YAML tal cual en **`/api/docs`** (y el JSON en `/api/docs-json`). No se genera desde decoradores, así que lo que se ve es exactamente el contrato acordado.
- `test/architecture/contract.spec.ts` compara el contrato con los controllers: que estén las 73 operaciones, sin rutas extra, con `@Roles` igual a `x-roles` y el mismo código de éxito.
- Las plantillas de WhatsApp (`GET /members/{id}/whatsapp-link`) salen de `contract/labels.json`.

## Arquitectura

Clean Architecture con separación estricta, controlada por ESLint (`eslint.config.mjs`, regla `no-restricted-imports` por carpeta):

```
src/
├── domain/          Reglas puras. No importa Nest, Prisma ni otras capas.
│   ├── shared/        DateOnly 'YYYY-MM-DD', Period 'YYYY-MM', Money, PhoneNumber, normalizaciones, errores con código estable
│   ├── members/       renewalStatus, baja automática, eventos de estado, WhatsApp
│   ├── attendances/   attendanceRisk
│   ├── cash/          validación de splits
│   ├── memberships/   reglas de membresía (vigente, fechas, regla 4 de 04 §4)
│   ├── metrics/       calculadora V1, catálogo de definiciones, planificación de cierres
│   ├── settings/      claves exactas de `settings`, defaults y validación de tipos
│   ├── audit/         armado y saneamiento de registros de auditoría
│   ├── ports/         Clock, PasswordHasher, TokenService, SecretGenerator, AttemptLimiter, LabelCatalog, UnitOfWork, AuditLogger
│   └── repositories/  interfaces de repositorio y formas de lectura
├── application/     Un caso de uso por operación. Solo importa domain.
├── infrastructure/  Único lugar con @prisma/client: PrismaService, repositorios, UnitOfWork ($transaction interactiva),
│                    argon2, JWT, reloj de Buenos Aires, crons, lectura del contrato
├── presentation/    Controllers, DTOs (class-validator), guards, filtro de errores, requestId. No importa infrastructure.
├── composition/     Raíz de composición: módulo Nest que une puertos con adaptadores y registra los casos de uso
└── main.ts
```

| Capa | Puede importar | No puede importar |
|---|---|---|
| domain | — | `@nestjs/*`, `@prisma/*`, librerías de framework, cualquier otra capa |
| application | domain | `@nestjs/*`, `@prisma/*`, infrastructure, presentation, composition |
| presentation | domain, application, `@nestjs/*` | `@prisma/*`, infrastructure, composition |
| infrastructure | domain, application | presentation, composition |
| composition | todo | — |

`test/architecture/boundaries.spec.ts` lintea código que viola cada regla y comprueba que ESLint falle.

**Flujo de una petición:** middleware `requestId` → `JwtAuthGuard` (valida el JWT y carga el usuario vigente) → `MustChangePasswordGuard` → `RolesGuard` (`@Roles` = `x-roles`) → `ValidationPipe` (DTO estricto) → controller → caso de uso → `UnitOfWork.run` (transacción con los repositorios y el `AuditLogger`) → `AllExceptionsFilter` traduce errores a `ErrorResponse { statusCode, code, message, details, requestId }`.

### Cómo agregar un endpoint respetando las capas

1. **Contrato:** agregá la operación en `../docs/05-api-openapi.yaml` (con `x-roles`) y corré `npm run contract:sync`.
2. **Dominio:** si hay reglas nuevas, van como funciones puras en `src/domain/...` con su test en `test/unit/domain`. Si necesitás datos nuevos, agregá el método a la interfaz en `src/domain/repositories/repositories.ts`.
3. **Aplicación:** creá el caso de uso en `src/application/<módulo>/` como clase sin decoradores que recibe puertos por constructor. Las escrituras van dentro de `uow.run(async (tx) => …)` y registran `tx.audit.log(…)` con `before`/`after`. Devolvé una vista con la forma del contrato (`src/application/common/views.ts`).
4. **Infraestructura:** implementá el método del repositorio en `src/infrastructure/prisma/repositories/`. Si es una lista con totales, usá el mismo `WHERE` para la página y los totales.
5. **Presentación:** DTO con class-validator en `src/presentation/dto/`, método en el controller con `@Roles(...)` copiado de `x-roles` y el `@HttpCode` del contrato.
6. **Composición:** registrá el caso de uso en `src/composition/app.module.ts` con `useCase(Clase, [dependencias])`.
7. **Tests:** caso de uso con repositorios en memoria (`test/support/in-memory.ts`). `npm run lint` y `npm test` tienen que pasar; el test de contrato avisa si la ruta o los roles no coinciden.

## Seguridad

- **Login:** mismo mensaje para email inexistente y contraseña incorrecta ("Credenciales inválidas", 401). Con `security.max_failed_attempts` fallos por email en `security.failed_attempts_window_minutes` minutos responde 429 hasta que pase la ventana.
- **Tokens:** access JWT HS256 de 15 minutos; refresh opaco aleatorio de 7 días guardado como sha256, rotativo. Si se reutiliza un refresh ya usado se revoca toda la familia. Cambiar la contraseña revoca los refresh y emite un par nuevo.
- **Usuario vigente en cada request:** el guard JWT vuelve a leer el usuario, así que desactivar a alguien o cambiarle el rol tiene efecto inmediato.
- **Egresos (D5):** crear, editar o anular un `EXPENSE` exige `confirmPassword` con la contraseña del usuario autenticado. Si no coincide → `403 PASSWORD_CONFIRMATION_INVALID` (no cierra la sesión); mismo límite de intentos que el login → 429. La auditoría guarda `passwordConfirmed = true`; la contraseña no se guarda ni se loguea.
- **Auditoría:** toda escritura de dominio registra, en la misma transacción, before/after, `changedFields`, usuario, `actorLabel`, `entityLabel` legible (p. ej. `LB045 – Juan Pérez`), `requestId`, IP y user agent. Nunca incluye hashes, tokens ni contraseñas. Si falla la auditoría, falla la operación.
- **Límite de intentos:** se lleva en memoria por instancia (04 §4 regla 6b lo deja a criterio del backend). Con varias instancias detrás de un balanceador, el límite efectivo se multiplica por la cantidad de instancias.

## Procesos automáticos

Con `@nestjs/schedule`, siempre en la zona de `app.timezone` (America/Argentina/Buenos_Aires). Cada corrida queda en `job_runs` y toma un lock exclusivo de transacción en PostgreSQL (`pg_try_advisory_xact_lock`), así dos instancias no hacen lo mismo a la vez:

| Proceso | Cuándo | Qué hace |
|---|---|---|
| Baja automática | Todos los días a las 03:00 | Pasa a `CANCELLED` a los socios activos con más de `members.auto_cancel_after_days` días vencidos (hoy 15, **pendiente de confirmación del usuario**). Evento `AUTO_CANCELLED` y auditoría a nombre de `system`. También hay un botón para ADMIN: `POST /members/auto-cancellations`. |
| Cierre preliminar | Último día del mes a `metrics.auto_close_time` (23:59) | Guarda el snapshot V1 del mes; vencimientos sin renovar y churn quedan provisionales. |
| Cierre definitivo | Día `metrics.renewal_grace_days + 1` del mes siguiente a `metrics.final_close_time` (el 16 a las 00:05) | Recalcula el mes completo, reemplaza al preliminar (que queda como historial) y congela el mes. |
| Recuperación al arrancar | Al iniciar la API | Corre la baja automática si no corrió hoy y cierra todo mes pendiente desde el primer mes con datos hasta el anterior al actual: `FINAL` si ya pasó la gracia, `PRELIMINARY` si no. |

Los horarios se leen de `settings` al arrancar: si se cambian, hay que reiniciar la API.

### Qué pasa en el primer arranque

Después de cargar `../sql`, la base tiene solo las 6 fotos del Excel como `REFERENCE` (no se muestran ni se grafican). Al arrancar por primera vez, la recuperación **reconstruye las métricas de abril a septiembre 2026** con las fórmulas V1 (03 §6b) y las guarda como cierres `FINAL` a nombre de `system`. Octubre se muestra en vivo mientras está en curso; el 31/10 a las 23:59 se guarda su cierre preliminar y el 16/11 a las 00:05 el definitivo. Si la API se levanta entre el 1 y el 16 de noviembre, la recuperación guarda octubre como `PRELIMINARY` y el cron del 16 lo reemplaza por el definitivo. Todo mes anterior a `metrics.cutover_period` (2026-11) se marca `isReconstructed = true`.

## Pruebas

- `npm test`: dominio (estado de cuota, riesgo de inasistencia, normalizaciones, baja automática, splits, calculadora de métricas con churn, gracia, provisionales, nulls y permanencia), casos de uso con repositorios en memoria (login, rotación y reuso del refresh, cambio obligatorio, egresos con contraseña correcta, incorrecta y bloqueada, renovar y anular con recálculo del vencimiento, check-in duplicado, totales de caja con el mismo filtro) y arquitectura (límites de capa y contrato).
- `npm run test:integration`: PostgreSQL 16 en Docker con los scripts reales de `../sql`, y pruebas e2e de login y cambio de contraseña, alta de socio con pago dividido, caja filtrada con totales, egreso con `confirmPassword`, check-in duplicado y métricas (vivo, reconstrucción, recálculo). No se conecta a Supabase ni a ninguna base remota.
