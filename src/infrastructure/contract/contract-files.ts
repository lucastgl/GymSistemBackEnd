import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { LabelCatalog } from '../../domain/ports/ports';

/**
 * Ubica `contract/<archivo>` subiendo desde el directorio actual y desde este archivo
 * (funciona igual con `ts-node`, `jest` y `dist/`). La fuente es docs/ (ver README).
 */
export function findContractFile(fileName: string): string {
  const starts = [process.cwd(), __dirname];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'contract', fileName);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`No se encontró contract/${fileName}. Ejecutá "npm run contract:sync".`);
}

export function loadOpenApiDocument(): Record<string, unknown> {
  return load(readFileSync(findContractFile('openapi.yaml'), 'utf8')) as Record<string, unknown>;
}

type LabelsFile = Record<string, Record<string, string>>;

/** Etiquetas y plantillas de WhatsApp de contract/labels.json (copia de docs/06-etiquetas.json). */
export class JsonLabelCatalog implements LabelCatalog {
  private readonly labels: LabelsFile;

  constructor(labels?: LabelsFile) {
    this.labels = labels ?? (JSON.parse(readFileSync(findContractFile('labels.json'), 'utf8')) as LabelsFile);
  }

  whatsappTemplate(key: string): string | null {
    return this.labels.WhatsappTemplate?.[key] ?? null;
  }

  label(enumName: string, value: string): string {
    return this.labels[enumName]?.[value] ?? value;
  }
}
