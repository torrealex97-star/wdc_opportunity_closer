// La comprobación en seco también se mide: lo que fija esta prueba es que cuente por motivo sin
// inventar, que el SELECT siga siendo solo lectura y que se ABORTE si el motor responde que no era
// una simulación. Sin red: `fetch` se sustituye.
// Uso: node tests/withdraw-preview.mjs
import assert from 'node:assert/strict';
import { activatePlan, aggregate, draftSql } from '../scripts/withdraw-preview.mjs';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

await step('recuento: cada motivo por separado, y lo que no se retira no se suma', async () => {
  const r = aggregate([
    { action: 'withdraw', reason: 'sin perfil comercial reconocible' },
    { action: 'withdraw', reason: 'sin perfil comercial reconocible' },
    { action: 'withdraw', reason: 'el anuncio no está en español ni en inglés' },
    { action: 'withdraw', reason: 'sin URL del anuncio: no se publica una tarjeta sin destino' },
    { action: 'publish_si_open' },
    { action: 'publish_si_open' },
    { action: 'needs_review' },
    { action: 'skipped', reason: 'perfil closer distinto del pedido (setter)' },
  ]);
  assert.equal(r.withdrawn, 4);
  assert.deepEqual(r.withdraw, {
    'sin perfil comercial reconocible': 2,
    'el anuncio no está en español ni en inglés': 1,
    'sin URL del anuncio: no se publica una tarjeta sin destino': 1,
  });
  assert.equal(r.publish, 2);
  assert.equal(r.review, 1);
  assert.equal(r.skipped, 1);
});

await step('recuento: un motivo ausente no se inventa y un item raro se declara aparte', async () => {
  const r = aggregate([{ action: 'withdraw' }, { action: 'otra_cosa' }, null]);
  assert.deepEqual(r.withdraw, { 'sin motivo': 1 });
  assert.equal(r.withdrawn, 1);
  assert.equal(r.other, 2);
  assert.equal(aggregate([]).withdrawn, 0);
});

await step('consulta: solo SELECT, una sola sentencia y el mismo filtro de borradores vivos', async () => {
  const sql = draftSql('2026-11-18T00:00:00.000Z');
  assert.match(sql, /^SELECT\b/);
  assert.match(sql, /editorial_status='draft'/);
  assert.match(sql, /opportunity_status <> 'closed'/);
  assert.match(sql, /c\.expires_at > '2026-11-18T00:00:00\.000Z'/);
  assert.throws(() => draftSql("2026-01-01'; DELETE FROM opportunities; --"), /solo SELECT|una sola consulta/);
});

await step('petición: dry_run viaja fijo y se exige en la respuesta', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ dry_run: true, considered: 1, scan: { truncated: false }, items: [{ action: 'withdraw', reason: 'x' }] }), { status: 200 });
    };
    const plan = await activatePlan('http://127.0.0.1:9/', 't', ['opp-1'], 'any');
    assert.equal(plan.items.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:9/v1/admin/opportunities/activate');
    assert.equal(calls[0].body.dry_run, true);
    assert.deepEqual(calls[0].body.ids, ['opp-1']);
    assert.equal(calls[0].body.market, 'any');
  } finally { globalThis.fetch = original; }
});

await step('petición: si el motor NO responde en seco, no se cuenta nada', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ dry_run: false, counts: { withdrawn: 7 }, items: [] }), { status: 200 });
    await assert.rejects(() => activatePlan('http://127.0.0.1:9', 't', ['opp-1']), /NO respondió en seco/);
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'No autorizado' }), { status: 401 });
    await assert.rejects(() => activatePlan('http://127.0.0.1:9', 't', ['opp-1']), /401/);
  } finally { globalThis.fetch = original; }
});

for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
