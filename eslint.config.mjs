// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Límites de capa (Clean Architecture). El lint falla si alguien los viola:
 * - domain: no importa otras capas, ni @nestjs/*, ni @prisma/client, ni librerías de framework.
 * - application: solo importa domain (y a sí misma).
 * - presentation: no importa infrastructure, composition ni @prisma/client.
 * - infrastructure: único lugar con @prisma/client; no importa presentation ni composition.
 * - composition (src/main.ts, src/composition/**): raíz de composición, puede importar todo.
 * test/architecture/boundaries.spec.ts verifica que estas reglas efectivamente fallen.
 */
const layerImport = (layers) => `^(?:\\.{1,2}/)+(?:[\\w.-]+/)*(?:${layers.join('|')})(?:/|$)`;

const prismaOnlyInInfrastructure = [
  { regex: '^@prisma/', message: '@prisma/client solo se importa desde src/infrastructure.' },
  { regex: '^\\.prisma/', message: '@prisma/client solo se importa desde src/infrastructure.' },
];

const frameworkLibs = {
  regex: '^(?:@nestjs/|class-validator$|class-transformer$|express$|@node-rs/|js-yaml$|cron$|date-fns)',
  message: 'domain y application no dependen de frameworks ni librerías de infraestructura (usá un puerto).',
};

export const boundaryRules = {
  domain: [
    ...prismaOnlyInInfrastructure,
    frameworkLibs,
    {
      regex: layerImport(['application', 'infrastructure', 'presentation', 'composition']),
      message: 'domain no puede importar de otras capas.',
    },
  ],
  application: [
    ...prismaOnlyInInfrastructure,
    frameworkLibs,
    {
      regex: layerImport(['infrastructure', 'presentation', 'composition']),
      message: 'application solo puede importar de domain.',
    },
  ],
  presentation: [
    ...prismaOnlyInInfrastructure,
    {
      regex: layerImport(['infrastructure', 'composition']),
      message: 'presentation no importa infraestructura: inyectá el puerto (domain/ports) o el caso de uso.',
    },
  ],
  infrastructure: [
    {
      regex: layerImport(['presentation', 'composition']),
      message: 'infrastructure no importa presentation ni composition.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'scripts/**', '**/*.js', '**/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': 'error',
    },
  },
  { files: ['src/domain/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: boundaryRules.domain }] } },
  { files: ['src/application/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: boundaryRules.application }] } },
  { files: ['src/presentation/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: boundaryRules.presentation }] } },
  { files: ['src/infrastructure/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: boundaryRules.infrastructure }] } },
  {
    files: ['test/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
