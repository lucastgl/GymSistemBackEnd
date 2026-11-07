'use strict';
// Copia el contrato desde docs/ (fuente de verdad) a contract/ (lo que sirve la API).
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const docs = path.resolve(root, '..', 'docs');
const pairs = [
  ['05-api-openapi.yaml', 'openapi.yaml'],
  ['06-etiquetas.json', 'labels.json'],
];
fs.mkdirSync(path.join(root, 'contract'), { recursive: true });
for (const [from, to] of pairs) {
  fs.copyFileSync(path.join(docs, from), path.join(root, 'contract', to));
  console.log(`docs/${from} -> contract/${to}`);
}
