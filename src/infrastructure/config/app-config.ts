/** Configuración por variables de entorno (ver .env.example). */
export interface AppConfig {
  port: number;
  corsOrigins: string[];
  jwtAccessSecret: string;
  jwtAccessTtlSeconds: number;
  refreshTokenTtlDays: number;
  jobsEnabled: boolean;
  trustProxy: boolean;
  /** Solo para pruebas: congela el reloj (ISO 8601). */
  fixedNow: Date | null;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} debe ser un entero positivo`);
  return n;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(raw.toLowerCase());
}

export function loadAppConfig(): AppConfig {
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET es obligatorio y debe tener al menos 32 caracteres');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL es obligatorio');
  const fixed = process.env.FIXED_NOW ? new Date(process.env.FIXED_NOW) : null;
  if (fixed && Number.isNaN(fixed.getTime())) throw new Error('FIXED_NOW no es una fecha ISO válida');
  return {
    port: intEnv('PORT', 3000),
    corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwtAccessSecret: secret,
    jwtAccessTtlSeconds: intEnv('JWT_ACCESS_TTL_SECONDS', 900),
    refreshTokenTtlDays: intEnv('REFRESH_TOKEN_TTL_DAYS', 7),
    jobsEnabled: boolEnv('JOBS_ENABLED', true),
    trustProxy: boolEnv('TRUST_PROXY', false),
    fixedNow: fixed,
  };
}
