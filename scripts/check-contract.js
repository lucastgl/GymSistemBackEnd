'use strict';
// Valida contract/ (copia commiteada de docs/) antes de compilar. Corre dentro de `npm run build`, que
// Vercel ejecuta en cada deploy: si falta o está roto un archivo, falla el build y no la API al arrancar.
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('js-yaml');

const dir = path.resolve(__dirname, '..', 'contract');
const files = [
  ['labels.json', JSON.parse],
  ['openapi.yaml', load],
];
let ok = true;
for (const [name, parse] of files) {
  try {
    const doc = parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (!doc || typeof doc !== 'object' || Object.keys(doc).length === 0) throw new Error('está vacío');
    console.log(`contract/${name} ok`);
  } catch (err) {
    ok = false;
    console.error(`contract/${name}: ${err.code === 'ENOENT' ? 'no existe' : err.message}`);
  }
}
if (!ok) {
  console.error('Contrato incompleto: corré "npm run contract:sync" (copia desde ../docs) y commiteá contract/.');
  process.exit(1);
}
