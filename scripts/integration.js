'use strict';
/**
 * Prueba de integración local: PostgreSQL 16 en Docker con los scripts reales de ../sql.
 *   node scripts/integration.js up     → levanta el contenedor y aplica 01 → 01b → 02 → 03a…03f → 06a (esquema Fase 4, si existe)
 *   node scripts/integration.js test   → corre jest con test/jest-integration.config.js
 *   node scripts/integration.js down   → baja y borra el contenedor
 *   node scripts/integration.js all    → up + test + down (siempre baja el contenedor)
 * No se conecta a Supabase ni a ninguna base remota.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NAME = 'lb-api-integration';
const PORT = process.env.INTEGRATION_DB_PORT || '55433';
const SQL_DIR = path.resolve(__dirname, '..', '..', 'sql');
const ROOT = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  return r;
}

function up() {
  run('docker', ['rm', '-f', NAME]);
  const started = run('docker', [
    'run', '-d', '--name', NAME, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', `127.0.0.1:${PORT}:5432`, 'postgres:16',
  ]);
  if (started.status !== 0) throw new Error(`No se pudo iniciar Docker: ${started.stderr}`);
  for (let i = 0; i < 60; i++) {
    const ready = run('docker', ['exec', NAME, 'pg_isready', '-U', 'postgres']);
    if (ready.status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  // pg_isready responde antes de que termine el init; esperamos una consulta real.
  for (let i = 0; i < 30; i++) {
    const q = run('docker', ['exec', NAME, 'psql', '-U', 'postgres', '-tAc', 'select 1']);
    if (q.status === 0 && q.stdout.trim() === '1') break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  run('docker', ['exec', NAME, 'psql', '-U', 'postgres', '-c', 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;']);
  const files = fs
    .readdirSync(SQL_DIR)
    .filter((f) => /^(01|01b|02|03[a-z]|06a)_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQL_DIR, f), 'utf8');
    const r = run('docker', ['exec', '-i', NAME, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`Falló ${f}: ${r.stderr.slice(0, 2000)}`);
    console.log(`aplicado sql/${f}`);
  }
  const check = run('docker', ['exec', '-i', NAME, 'psql', '-U', 'postgres', '-tA', '-F', '|'], {
    input: fs.readFileSync(path.join(SQL_DIR, '04_verificacion.sql'), 'utf8'),
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = check.stdout.split(/\r?\n/).filter((l) => l.includes('|'));
  const failed = lines.filter((l) => /\|f$/.test(l.trim()));
  console.log(`04_verificacion.sql: ${lines.length - failed.length} ok, ${failed.length} con diferencias`);
  failed.slice(0, 20).forEach((l) => console.log(`  ✗ ${l}`));
}

function test() {
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres@127.0.0.1:${PORT}/postgres`,
    DIRECT_URL: `postgresql://postgres@127.0.0.1:${PORT}/postgres`,
  };
  const jest = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
  const r = spawnSync(process.execPath, [jest, '--config', 'test/jest-integration.config.js', '--runInBand'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  return r.status ?? 1;
}

function down() {
  run('docker', ['rm', '-f', NAME]);
  console.log(`contenedor ${NAME} eliminado`);
}

const cmd = process.argv[2] || 'all';
if (cmd === 'up') up();
else if (cmd === 'down') down();
else if (cmd === 'test') process.exitCode = test();
else {
  let code = 1;
  try {
    up();
    code = test();
  } finally {
    down();
  }
  process.exitCode = code;
}
