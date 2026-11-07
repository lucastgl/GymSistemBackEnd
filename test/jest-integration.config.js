/** Prueba de integración e2e contra PostgreSQL 16 en Docker (la levanta scripts/integration.js; ver README). */
module.exports = {
  rootDir: '..',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.e2e-spec.ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testTimeout: 120000,
};
