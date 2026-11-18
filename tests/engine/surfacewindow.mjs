// Ventana de la vista de alumna: ya no son las 800 entradas de catálogo más recientes, sino
// todo lo publicado/aprobado vigente; y lo que se DEVUELVE lleva tope por fuente y tope de
// tarjetas, con el corte declarado (`truncated`). Sin red y sin Cloudflare: shim de D1.
// Uso: node --experimental-strip-types tests/engine/surfacewindow.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-window-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = (await import(pathToFileURL(stage).href)).default;
const workerModule = await import(pathToFileURL(stage).href);

const COLD_TEXT = 'Buscamos teleoperador para llamadas en frío. Ofrecemos jornada completa, comisiones y formación. Experiencia previa atendiendo clientes por teléfono.';
const CLOSER_TEXT = 'Buscamos closer para cerrar ventas high ticket por videollamada. Ofrecemos salario, comisiones y formación. Experiencia mínima de un año cerrando operaciones con clientes.';
// Una sola fecha para todas las filas: el empate por frescura deja decidir al perfil, y la
// prueba no depende del milisegundo en que se construya cada fila.
const POSTED = new Date(Date.now() - 86400000).toISOString();

const row = (id, { title, description, source }) => ({
  job_id: id, starred: 0, source,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  payload: JSON.stringify({
    title, company: `Empresa ${id}`, location: 'Madrid, España', url: `https://x.test/${id}`,
    posted_at: POSTED, raw: { description },
  }),
});

// 60 de una fuente de teleoperadores y 10 closers de otra: sin tope, la primera llenaría la lista.
const rows = [
  ...Array.from({ length: 60 }, (_, i) => row(`cold-${i}`, { title: `Teleoperador de ventas ${i}`, description: COLD_TEXT, source: 'fuente-a' })),
  ...Array.from({ length: 10 }, (_, i) => row(`closer-${i}`, { title: `Closer de ventas ${i}`, description: CLOSER_TEXT, source: 'fuente-b' })),
];

function fakeDb(fixture) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'all', sql, args: stmt.args });
        // La superficie consulta `opportunities`; el diagnóstico del embudo, el catálogo.
        if (/FROM (?:opportunities o|catalog_entries c)/.test(sql)) return { results: fixture };
        return { results: [] };
      },
      async first() { log.push({ kind: 'first', sql }); return null; },
      async run() { log.push({ kind: 'run', sql }); return { meta: { changes: 1 } }; },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) { for (const s of stmts) await s.run(); return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
}

const search = async (db, env = {}, body = {}) => {
  db.log.length = 0;
  const response = await worker.fetch(
    new Request('https://engine.test/v1/opportunities/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    { DB: db, ...env },
    // La ruta lanza un refresco perezoso con waitUntil: el shim no ejecuta recogidas (sin red).
    { waitUntil() {} },
  );
  return { status: response.status, body: await response.json() };
};

const perSource = items => items.reduce((acc, o) => ({ ...acc, [o.source_code]: (acc[o.source_code] ?? 0) + 1 }), {});

// 1) La consulta de la superficie recorre lo publicado, no la ventana de 800 del catálogo.
{
  const db = fakeDb(rows);
  const { status, body } = await search(db, {}, { market: 'any', days: 10 });
  assert.equal(status, 200);
  const surfaceSql = db.log.find(entry => entry.kind === 'all' && /FROM opportunities o/.test(entry.sql));
  assert.ok(surfaceSql, 'la superficie se consulta desde opportunities');
  assert.match(surfaceSql.sql, /editorial_status IN \('approved','published'\)/);
  assert.doesNotMatch(surfaceSql.sql, /LIMIT 800/, 'el 800 de la ventana de catálogo desaparece');
  assert.equal(surfaceSql.args.at(-1), 3000, 'el barrido por defecto cubre todo lo publicado');
  // `total` es lo que pasa las puertas, no lo que se devuelve.
  assert.equal(body.total, 70);
}

// 2) Tope por fuente: 40 de la fuente que inunda, y las 10 de la otra (que rankean antes).
{
  const db = fakeDb(rows);
  const { body } = await search(db, {}, { market: 'any', days: 10 });
  assert.deepEqual(perSource(body.items), { 'fuente-b': 10, 'fuente-a': 40 });
  assert.equal(body.items.length, 50);
  assert.equal(body.truncated, true, 'el recorte se declara');
  assert.equal(body.items[0].source_code, 'fuente-b', 'el tope no altera el orden: los closers siguen primero');
}

// 3) Los topes se pueden ajustar por entorno y el de tarjetas corta antes que el de fuente.
{
  const db = fakeDb(rows);
  const { body } = await search(db, { SURFACE_SOURCE_CAP: '3' }, { market: 'any', days: 10 });
  assert.deepEqual(perSource(body.items), { 'fuente-b': 3, 'fuente-a': 3 });
  assert.equal(body.total, 70);

  const db2 = fakeDb(rows);
  const { body: body2 } = await search(db2, { SURFACE_MAX_ITEMS: '12' }, { market: 'any', days: 10 });
  assert.equal(body2.items.length, 12, 'el tope de tarjetas manda sobre el de fuente');
  assert.equal(body2.truncated, true);
}

// 3b) Tope por empresa: tres vacantes casi idénticas del mismo empleador no copan la lista, y una
//     empresa sin nombre no se agrupa con las demás.
{
  const same = [1, 2, 3].map(i => row(`inmark-${i}`, { title: `Closer de ventas ${i}`, description: CLOSER_TEXT, source: 'fuente-b' }))
    .map(r => ({ ...r, payload: JSON.stringify({ ...JSON.parse(r.payload), company: 'Grupo Empresarial Inmark' }) }));
  const other = row('otra', { title: 'Closer de ventas otra', description: CLOSER_TEXT, source: 'fuente-b' });
  const db = fakeDb([...same, other]);
  const { body } = await search(db, {}, { market: 'any', days: 10 });
  assert.equal(body.items.filter(item => item.company === 'Grupo Empresarial Inmark').length, 2, 'máx. 2 por empresa');
  assert.equal(body.items.length, 3);
  assert.equal(body.truncated, true);
}

// 4) Un valor inválido no se convierte en cero: cae al defecto (regla de presupuesto del motor).
{
  const limits = workerModule.__test.surfaceLimits({ SURFACE_SCAN_LIMIT: 'muchas', SURFACE_SOURCE_CAP: '-4', SURFACE_MAX_ITEMS: '0' });
  assert.deepEqual(limits, { scan: 3000, perSource: 40, perCompany: 2, serve: 400 });
}

// 5) El diagnóstico del embudo (editorialOnly false) conserva su consulta de catálogo: mide el
//    pool, no la superficie, y no se le aplica el tope por fuente.
{
  const db = fakeDb(rows);
  const { ranked, total } = await workerModule.__test.studentSurface({ DB: db }, {
    role: null, market: 'any', days: 10, includeBilingual: false,
    starredOnly: false, includeExtraRoles: true, editorialOnly: false,
  });
  const funnelSql = db.log.find(entry => entry.kind === 'all' && /FROM catalog_entries c/.test(entry.sql));
  assert.ok(funnelSql, 'el embudo sigue leyendo el catálogo');
  assert.match(funnelSql.sql, /FROM catalog_entries c/);
  assert.match(funnelSql.sql, /LIMIT 800/);
  assert.equal(total, 70, 'el embudo no pasa por el tope por fuente');
  assert.equal(ranked.length, 70);
}

console.log('surfacewindow: OK');
