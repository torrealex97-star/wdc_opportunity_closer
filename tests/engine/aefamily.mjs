// Familia «Ejecutivo comercial» afinada y publicación que no gasta en AE genérico.
// Medido sobre las 1.543 publicadas como AE (2026-11-18): 77 títulos de otro oficio salen del
// perfil y 0 closers se pierden. Sin red ni Cloudflare: worker importado y D1 simulado.
// Uso: node --experimental-strip-types tests/engine/aefamily.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-ae-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = (await import(pathToFileURL(stage).href)).default;
const t = (await import(pathToFileURL(stage).href)).__test;

// Texto comercial neutro: si el título no dice el oficio, el cuerpo no basta para ser AE.
const BODY = 'Buscamos persona para el equipo comercial. Ofrecemos salario, comisiones y formación. Experiencia con clientes y ventas.';
const role = (title, body = BODY) => t.classifyRole({ title }, `${title} Madrid, España ${body}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());

// 1) El título de otro oficio no entra en ninguna familia comercial, diga lo que diga el cuerpo.
for (const title of [
  'EMEA Platform Solution Architect', 'Chief Strategic Architect', 'Arquitecta Comercial - InPiedra',
  'Senior Data Business Analyst / Product Owner', 'Analista Comercial', 'Analista de Desenvolvimento de Negócios Sr',
  'ADMINISTRATIVO/A COMERCIAL', 'Auxiliar Administrativo Comercial', 'Administrativo/a Comercial con Francés',
  'Atención al Cliente', 'Asesor/a comercial y atención al cliente (Sector Energético)',
  'Recepcionista Comercial – Clínica de Medicina Estética', 'Agente Comercial Recepción Llamadas - Madrid',
  'Ingeniero/a Técnico/a Comercial', 'Senior Sales Engineer, DACH', 'Software-Entwickler (m/w/d) C++',
]) {
  assert.equal(role(title), null, `no debería tener perfil comercial: ${title}`);
}
// El caso que la variante anterior colaba como closer: la recepcionista.
assert.equal(role('Recepcionista Comercial'), null, 'ni closer: el título nombra otro oficio');

// 2) Los títulos de venta real no se pierden (los que el vocabulario no tenía o usa barra).
assert.equal(role('Ejecutivo/a de Ventas – Copiapó'), 'account_executive');
assert.equal(role('Dependienta de tienda – Hairstore Barcelona'), 'account_executive');
assert.equal(role('Agente de Seguros y Banco Cdmx y Edomex'), 'account_executive');
assert.equal(role('KAE Jr'), 'account_executive', 'Key Account Executive');
assert.equal(role('SALES ASSISTANT'), 'account_executive');
assert.equal(role('Field Sales | Barcelona'), 'account_executive');
assert.equal(role('Business Developer'), 'closer', '«developer» no excluye: business developer cierra');
assert.equal(role('Closer de ventas'), 'closer');
assert.equal(role('Sales Manager'), 'management');

// 3) La familia AE no nace solo del cuerpo: sin señal comercial en el título, no hay AE.
assert.equal(role('Partner de éxito', 'Trabajarás con el equipo de ventas y clientes.'), null);
// …pero con señal comercial en el título, el cuerpo sí decide.
assert.equal(role('Commercial Manager', 'Responsable del área comercial: equipo de ventas y relación con clientes.'), 'account_executive');

// ---- Activación: publicar no gasta en AE genérico ----
function fakeDb(pool) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'all', sql, args: stmt.args });
        if (/FROM opportunities o/.test(sql)) return { results: pool };
        return { results: [] };
      },
      async first() {
        log.push({ kind: 'first', sql, args: stmt.args });
        if (/SELECT max\(version\)/.test(sql)) return { v: 1 };
        if (/SELECT id FROM opportunity_versions/.test(sql)) return { id: 'ver-seed' };
        return null;
      },
      async run() { log.push({ kind: 'run', sql, args: stmt.args }); return { meta: { changes: 1 } }; },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) { for (const s of stmts) await s.run(); return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
}

const offer = (title, extra = {}) => ({
  title, location: 'Madrid, España', company: 'Acme', url: 'https://empleo.example.com/oferta',
  raw: { description: 'Buscamos closer para cerrar ventas high ticket. Ofrecemos salario y comisiones. Experiencia con clientes.' },
  posted_at: new Date().toISOString(), ...extra,
});
const row = (id, payload) => ({
  opportunity_id: id, job_id: `job-${id}`, current_version_id: 'ver-seed', editorial_status: 'draft',
  opportunity_status: 'verifying', posting_id: `post-${id}`, source: 'jobtoday-closer',
  posting_payload: JSON.stringify(payload), expires_at: '2030-01-01T00:00:00.000Z',
  first_seen_at: '2026-10-20T00:00:00.000Z',
});

const activate = async (db, body) => {
  db.log.length = 0;
  const response = await worker.fetch(
    new Request('https://engine.test/v1/admin/opportunities/activate', {
      method: 'POST', headers: { 'X-Admin-Token': 'token-de-prueba', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: db, ADMIN_TOKEN: 'token-de-prueba' },
    { waitUntil() {} },
  );
  return { status: response.status, body: await response.json() };
};
const businessWrites = db => db.log.filter(entry => entry.kind === 'run' && /^(INSERT|UPDATE|DELETE)/.test(entry.sql)
  && !/schema_version|CREATE TABLE/.test(entry.sql));

// 4) Un AE en el pool no se publica ni se retira: queda igual y no gasta verificación ni escrituras.
{
  const pool = [row('opp-ae', offer('Account Executive')), row('opp-closer', offer('Closer de ventas'))];
  const db = fakeDb(pool);
  const { status, body } = await activate(db, { dry_run: false, verify: false, market: 'any' });
  assert.equal(status, 200);
  assert.equal(body.counts.published, 1, 'solo se publica el closer');
  const ae = body.items.find(item => item.id === 'opp-ae');
  assert.equal(ae.action, 'skipped');
  assert.match(ae.reason, /no gasta publicación/, 'el motivo lo declara');
  assert.equal(body.items.find(item => item.id === 'opp-closer').action === 'skipped', false);
  const aeWrites = businessWrites(db).filter(entry => (entry.args ?? []).includes('opp-ae'));
  assert.equal(aeWrites.length, 0, 'ninguna escritura toca el AE: no se publica ni se retira');
}

// 5) El opt-in explícito del operador lo publica como antes.
{
  const pool = [row('opp-ae', offer('Account Executive')), row('opp-closer', offer('Closer de ventas'))];
  const db = fakeDb(pool);
  const { body } = await activate(db, { dry_run: false, verify: false, market: 'any', publish_account_executive: true });
  assert.equal(body.counts.published, 2, 'con publish_account_executive se publica el AE');
  assert.equal(body.items.some(item => item.id === 'opp-ae' && item.action === 'skipped'), false);
}

// 6) Un título de otro oficio se retira como «sin perfil», no se publica ni se queda en la cola.
{
  const pool = [row('opp-arq', offer('Platform Solution Architect'))];
  const db = fakeDb(pool);
  const { body } = await activate(db, { dry_run: true, market: 'any' });
  assert.equal(body.counts.published, 0);
  assert.equal(body.items.find(item => item.id === 'opp-arq').reason, 'sin perfil comercial reconocible');
}

console.log('aefamily: OK');
