// El arnés de auditoría del vocabulario mide, así que también tiene que estar medido.
// Lo que fija esta prueba: que solo se pueda LEER, que el cambio de keywords se aplique sin mutar
// el original, que el motor propuesto clasifique de verdad distinto, y que el recuento de
// recuperados/regresiones/revisadas no se invente.
// Uso: node --experimental-strip-types tests/vocabulary-audit.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyVocabularyPatch, assertSelectOnly, buildCandidateEngine, currentEngine, parseVocabulary,
  replaceVocabularyBlock, summarize,
} from '../scripts/vocabulary-audit.mjs';

const workerPath = fileURLToPath(new URL('../sites/engine/worker.js', import.meta.url));
const worker = readFileSync(workerPath, 'utf8');

// ── Solo lectura ────────────────────────────────────────────────────────────────────────────
for (const sql of ['DELETE FROM raw_items', 'UPDATE jobs SET role=1', 'INSERT INTO x VALUES (1)', 'PRAGMA writable_schema=1']) {
  assert.throws(() => assertSelectOnly(sql), /solo SELECT/, `se rechaza: ${sql}`);
}
assert.equal(assertSelectOnly('  SELECT title FROM raw_items'), 'SELECT title FROM raw_items');
assert.throws(() => assertSelectOnly('SELECT 1; DELETE FROM raw_items'), /una sola consulta/);

// ── El cambio de vocabulario ───────────────────────────────────────────────────────────────
const base = parseVocabulary(worker);
assert.ok(base.setter.includes('bdr'), 'el motor actual reconoce bdr como setter');
assert.ok(base.closer.includes('business developer'));

const patched = applyVocabularyPatch(base, {
  add: { setter: ['test term', 'test term'] },
  remove: { closer: ['business developer'] },
});
assert.equal(patched.setter.filter(t => t === 'test term').length, 1, 'sin duplicar al añadir');
assert.ok(!patched.closer.includes('business developer'), 'quita el término');
assert.ok(base.closer.includes('business developer'), 'no muta el vocabulario original');
assert.deepEqual(base.setter, parseVocabulary(worker).setter, 'ni el orden ni el contenido cambian entre lecturas');

assert.throws(() => applyVocabularyPatch(base, { add: { inventada: ['x'] } }), /familia desconocida/);
assert.throws(() => applyVocabularyPatch(base, { remove: { inventada: ['x'] } }), /familia desconocida/);
assert.throws(() => applyVocabularyPatch(base, { add: { setter: ['  '] } }), /término vacío/);
// Un vocabulario completo al que le falta una familia no se puede auditar: el motor la evaluaría igual.
assert.throws(() => replaceVocabularyBlock(worker, { closer: [], setter: [] }), /falta la familia/);

// ── El motor propuesto clasifica distinto (es lo que hace útil al arnés) ────────────────────
const before = await currentEngine();
const after = await buildCandidateEngine(applyVocabularyPatch(base, { remove: { setter: ['bdr', 'adr'] }, add: { sdr: ['bdr'] } }));
assert.equal(before.classifyRole({ title: 'BDR' }, ''), 'setter');
assert.equal(after.classifyRole({ title: 'BDR' }, ''), 'sdr', 'con el cambio, bdr vuelve a sdr');
assert.equal(after.classifyRole({ title: 'ADR' }, ''), null, 'y adr se queda sin familia');
assert.equal(before.classifyRole({ title: 'Business Developer' }, ''), 'closer', 'el motor base no se toca');

// ── Recuento: recuperados, regresiones y fichas revisadas ───────────────────────────────────
const rows = [
  { title: 'BDR', location: '', body: '', status: 'published' },              // setter → null (regresión)
  { title: 'ADR', location: '', body: '', status: 'draft' },                  // setter → null (regresión)
  { title: 'Closer de ventas', location: '', body: '', status: 'approved' },  // igual
  { title: 'BDR', location: '', body: '', status: 'withdrawn' },              // duplicado del título: no cuenta dos veces
  // «Analista de Pré Vendas BDR» ya no clasifica: `nonSalesTitle` descarta «analista»
  // (sesión 219). El caso que importa —un título con BDR fuera de la palabra exacta—
  // se cubre con «Comercial BDR», que sigue siendo setter antes y sdr después.
  { title: 'Comercial BDR', location: '', body: '', status: 'needs_review' },
];
const result = summarize(rows, before, after, { window: 800, hasWord: before.hasWord });
assert.equal(result.titles, 4, 'dedupe por título normalizado');
assert.equal(result.changed, 3);
assert.equal(result.lost, 1, 'solo ADR pierde familia: los dos BDR pasan a sdr');
assert.equal(result.recovered, 0);
assert.equal(result.reviewed.rows, 2, 'solo approved/published; needs_review no cuenta como revisada');
assert.deepEqual(result.reviewed.transitions, { 'setter → sdr': 1 }, 'la ficha publicada se mueve de filtro, no se pierde');

// El filtro por términos no cambia los totales de títulos, solo lo que se mira.
const focused = summarize(rows, before, after, { terms: ['bdr'], window: 800, hasWord: before.hasWord });
assert.equal(focused.titles, 4);
assert.equal(focused.selected, 2, 'dos títulos contienen BDR: «BDR» y «Analista de Pré Vendas BDR»');
assert.equal(focused.changed, 2, 'los dos cambian de familia con el cambio');
assert.equal(focused.lost, 0, 'ninguno de los que llevan BDR se queda sin familia: pasan a sdr');

console.log('PASS  el arnés de auditoría del vocabulario solo lee, aplica el cambio y cuenta bien');
