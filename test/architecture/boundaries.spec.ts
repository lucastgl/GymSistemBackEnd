import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Verifica que ESLint FALLE ante violaciones de los límites de capa (eslint.config.mjs).
 * Se lintea texto por stdin simulando archivos de cada capa; no se crean archivos.
 */
const root = join(__dirname, '..', '..');
const eslintBin = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

function lint(fileName: string, code: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [eslintBin, '--stdin', '--stdin-filename', fileName], {
    cwd: root,
    input: code,
    encoding: 'utf8',
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('límites de capa (Clean Architecture)', () => {
  jest.setTimeout(120_000);

  it('domain no puede importar Nest, Prisma ni otras capas', () => {
    const r = lint(
      'src/domain/shared/violation.ts',
      "import { Injectable } from '@nestjs/common';\nimport { PrismaClient } from '@prisma/client';\nimport { userView } from '../../application/common/views';\nexport const x = [Injectable, PrismaClient, userView];\n",
    );
    expect(r.status).toBe(1);
    expect(r.output).toContain('domain no puede importar de otras capas');
    expect(r.output).toContain('@prisma/client solo se importa desde src/infrastructure');
    expect(r.output.match(/no-restricted-imports/g)).toHaveLength(3);
  });

  it('application solo importa domain', () => {
    const r = lint(
      'src/application/x/violation.ts',
      "import { PrismaService } from '../../infrastructure/prisma/prisma.service';\nimport { Controller } from '@nestjs/common';\nexport const x = [PrismaService, Controller];\n",
    );
    expect(r.status).toBe(1);
    expect(r.output).toContain('application solo puede importar de domain');
  });

  it('presentation no importa infraestructura ni @prisma/client', () => {
    const r = lint(
      'src/presentation/x/violation.ts',
      "import { PrismaService } from '../../infrastructure/prisma/prisma.service';\nimport { Prisma } from '@prisma/client';\nexport const x = [PrismaService, Prisma];\n",
    );
    expect(r.status).toBe(1);
    expect(r.output.match(/no-restricted-imports/g)).toHaveLength(2);
  });

  it('infrastructure sí puede usar @prisma/client y domain', () => {
    const r = lint(
      'src/infrastructure/x/ok.ts',
      "import { Prisma } from '@prisma/client';\nimport { DateOnly } from '../../domain/shared/date-only';\nexport const x = [Prisma, DateOnly];\n",
    );
    expect(r.status).toBe(0);
  });
});
