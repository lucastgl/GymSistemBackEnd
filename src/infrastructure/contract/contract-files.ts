import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { load } from 'js-yaml';
import { LabelCatalog } from '../../domain/ports/ports';

/*
 * contract/ relativo a este archivo: `src/infrastructure/contract/` (ts-node, jest y la función de Vercel, que
 * compila src/ en el lugar) y `dist/infrastructure/contract/` (`nest build`) están a tres niveles de la raíz.
 * Las rutas van literales a propósito: Vercel arma la función siguiendo el código (@vercel/nft) y solo incluye
 * los archivos cuya ruta puede calcular sin ejecutarlo. Una ruta armada en un bucle lo deja afuera.
 */
const LABELS_PATH = join(__dirname, '..', '..', '..', 'contract', 'labels.json');
const OPENAPI_PATH = join(__dirname, '..', '..', '..', 'contract', 'openapi.yaml');

/**
 * Devuelve `bundledPath` si existe; si no, `contract/<archivo>` de `process.cwd()` con un aviso
 * (significa que el contrato no viajó junto al código). La fuente es docs/ (ver README).
 */
export function findContractFile(bundledPath: string): string {
  if (existsSync(bundledPath)) return bundledPath;
  const fileName = basename(bundledPath);
  const fromCwd = join(process.cwd(), 'contract', fileName);
  if (existsSync(fromCwd)) {
    new Logger('Contract').warn(`contract/${fileName} no está junto al código (${bundledPath}); se usa ${fromCwd}.`);
    return fromCwd;
  }
  throw new Error(
    `No se encontró contract/${fileName} (buscado en ${bundledPath} y ${fromCwd}). ` +
      'Tiene que estar commiteado: se genera con "npm run contract:sync" y "npm run build" lo valida.',
  );
}

export function loadOpenApiDocument(): Record<string, unknown> {
  return load(readFileSync(findContractFile(OPENAPI_PATH), 'utf8')) as Record<string, unknown>;
}

type LabelsFile = Record<string, Record<string, string>>;

/** Etiquetas y plantillas de WhatsApp de contract/labels.json (copia de docs/06-etiquetas.json). */
export class JsonLabelCatalog implements LabelCatalog {
  private readonly labels: LabelsFile;

  constructor(labels?: LabelsFile) {
    this.labels = labels ?? (JSON.parse(readFileSync(findContractFile(LABELS_PATH), 'utf8')) as LabelsFile);
  }

  whatsappTemplate(key: string): string | null {
    return this.labels.WhatsappTemplate?.[key] ?? null;
  }

  label(enumName: string, value: string): string {
    return this.labels[enumName]?.[value] ?? value;
  }
}
