// Cerrar lo caducado: borradores y cola humana cuyo anuncio ya no está en el catálogo se retiran
// con su motivo, para que el panel no enseñe como pendiente lo que la vista de alumna no servirá.
// Sin red ni Cloudflare: worker importado y D1 simulado.
// Uso: node --experimental-strip-types tests/engine/expiredqueue.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-expired-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const worker = (await import(pathToFileURL(stage).href)).default;

// D1 simulado: el SELECT devuelve los ids sembrados por estado y anota cada escritura.
function fakeDb(byStatus) {
  const log = [];
  const statement = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt; },
      async all() {
        log.push({ kind: 'all', sql, args: stmt.args });
        if (/FROM opportunities o/.test(sql) && /c\.expires_at <= \?/.test(sql)) {
          const status = stmt.args[1];
          return { results: (byStatus[status] ?? []).map(id => ({ id })) };
        }
        return { results: [] };
      },
      async first() { log.push({ kind: 'first', sql }); return null; },
      async run() {
        log.push({ kind: 'run', sql, args: stmt.args });
        // `changes` = ids de esta escritura que siguen en el estado esperado.
        const status = stmt.args[3];
        return { meta: { changes: byStatus[status]?.length ?? 0 } };
      },
    };
    return stmt;
  };
  return {
    log,
    prepare: statement,
    async batch(stmts) { for (const s of stmts) await s.run(); return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
}

const closeExpired = async (db, body = {}, token = 'token-de-prueba') => {
  db.log.length = 0;
  const response = await worker.fetch(
    new Request('https://engine.test/v1/admin/opportunities/close-expired', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) },
      body: JSON.stringify(body),
    }),
    { DB: db, ADMIN_TOKEN: 'token-de-prueba' },
    { waitUntil() {} },
  );
  return { status: response.status, body: await response.json() };
};

const writes = db => db.log.filter(entry => entry.kind === 'run' && /^UPDATE/.test(entry.sql));

// 1) Sin token no se cierra nada.
{
  const db = fakeDb({ draft: ['d1'], needs_review: ['r1'] });
  const { status } = await closeExpired(db, {}, null);
  assert.equal(status, 401);
  assert.equal(writes(db).length, 0);
}

// 2) El plan (por defecto) cuenta lo caducado y NO escribe.
{
  const db = fakeDb({ draft: ['d1', 'd2'], needs_review: ['r1'] });
  const { status, body } = await closeExpired(db);
  assert.equal(status, 200);
  assert.equal(body.dry_run, true);
  assert.deepEqual(body.counts, { draft: 2, needs_review: 1, total: 3, withdrawn: 0 });
  assert.equal(writes(db).length, 0, 'un plan no escribe');
}

// 3) Ejecución real: retira con motivo, guarda el estado y cuenta solo lo que cambia.
{
  const db = fakeDb({ draft: ['d1', 'd2'], needs_review: ['r1'] });
  const { body } = await closeExpired(db, { dry_run: false });
  assert.equal(body.counts.withdrawn, 3);
  const updates = writes(db);
  assert.equal(updates.length, 2, 'una escritura por estado, no una por oferta');
  for (const update of updates) {
    assert.match(update.sql, /editorial_status='withdrawn'/);
    assert.match(update.sql, /AND editorial_status=\?/, 'no pisa lo que una persona movió');
    assert.match(update.args[0], /caducada en el catálogo/);
  }
  assert.equal(db.log.filter(entry => /^DELETE/.test(entry.sql ?? '')).length, 0, 'reversible: nunca DELETE');
}

// 4) Idempotente: repetir cuando ya no queda nada devuelve 0 y no escribe.
{
  const db = fakeDb({ draft: [], needs_review: [] });
  const { body } = await closeExpired(db, { dry_run: false });
  assert.equal(body.counts.total, 0);
  assert.equal(body.counts.withdrawn, 0);
  assert.equal(writes(db).length, 0);
}

// 5) El corte por lote se declara en vez de mentir con un total completo.
{
  const db = fakeDb({ draft: ['d1', 'd2', 'd3'], needs_review: [] });
  const { body } = await closeExpired(db, { dry_run: true, limit: 2 });
  assert.equal(body.counts.draft, 2);
  assert.equal(body.truncated.draft, true);
}

console.log('expiredqueue: OK');
