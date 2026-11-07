/**
 * Identificadores de inyección de los puertos. Son símbolos planos (sin Nest) para que
 * presentación y la raíz de composición los compartan sin depender de infraestructura.
 */
export const TOKENS = {
  Clock: Symbol.for('lb.Clock'),
  PasswordHasher: Symbol.for('lb.PasswordHasher'),
  TokenService: Symbol.for('lb.TokenService'),
  SecretGenerator: Symbol.for('lb.SecretGenerator'),
  AttemptLimiter: Symbol.for('lb.AttemptLimiter'),
  LabelCatalog: Symbol.for('lb.LabelCatalog'),
  UnitOfWork: Symbol.for('lb.UnitOfWork'),
  Repositories: Symbol.for('lb.Repositories'),
} as const;
