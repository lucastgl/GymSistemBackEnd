/** Tests unitarios (dominio), de casos de uso (repositorios en memoria) y de arquitectura. */
module.exports = {
  rootDir: '.',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts', '<rootDir>/test/application/**/*.spec.ts', '<rootDir>/test/architecture/**/*.spec.ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
};
