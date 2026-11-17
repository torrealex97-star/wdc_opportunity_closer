// Marcador por fuente: solo las cuentas (por 1.000 anuncios vivos, sin denominador no hay tasa,
// ofertas sin fuente localizable aparte). Sin red ni base de datos.
// Uso: node --experimental-strip-types tests/source-scorecard.mjs
import assert from 'node:assert/strict';
import { scorecard, scorecardTotals } from '../apps/web/lib/sourceScorecard.ts';

const sources = new Map([
  ['ext-1', 'jobtoday'], ['ext-2', 'jobtoday'], ['ext-3', 'infojobs'], ['ext-4', 'infojobs'], ['ext-5', 'infojobs'], ['ext-6', 'infojobs'],
]);
const ingested = new Map([['jobtoday', 1000], ['infojobs', 500], ['remotive', 0]]);
const apps = [
  { offer_ref: 'ext-1', status: 'applied' },
  { offer_ref: 'ext-2', status: 'interview' },
  { offer_ref: 'ext-3', status: 'applied' },
  { offer_ref: 'ext-4', status: 'rejected' },
  { offer_ref: 'ext-5', status: 'offer' },
  { offer_ref: 'ext-6', status: 'draft' },
  { offer_ref: 'ext-999', status: 'applied' },
];

const rows = scorecard(apps, sources, ingested);
const by = new Map(rows.map(row => [row.source, row]));

// jobtoday: 2 enviadas (applied + interview), 1 entrevista; el borrador no cuenta.
assert.equal(by.get('jobtoday').sent, 2);
assert.equal(by.get('jobtoday').interviews, 1);
assert.equal(by.get('jobtoday').per_1000.sent, 2);
assert.equal(by.get('jobtoday').per_1000.interviews, 1);
// infojobs: 3 enviadas (el borrador no viaja), 2 respuestas (rejected + offer), 1 entrevista (la oferta), 1 oferta.
assert.equal(by.get('infojobs').sent, 3);
assert.equal(by.get('infojobs').responded, 2);
assert.equal(by.get('infojobs').interviews, 1);
assert.equal(by.get('infojobs').offers, 1);
assert.equal(by.get('infojobs').per_1000.interviews, 2, '1 entre 500 → 2 por mil');
// Sin anuncios vivos el denominador es un hueco, no un cero.
assert.ok(by.has('remotive'), 'la fuente ingerida sin candidaturas también sale');
assert.equal(by.get('remotive').per_1000.sent, null);
// Una oferta borrada no se atribuye a una fuente inventada.
assert.equal(by.get('sin fuente localizable').sent, 1);
assert.equal(by.get('sin fuente localizable').per_1000.sent, null);
// Orden: primero quien más entrevistas por mil saca, y los huecos al final.
assert.deepEqual(rows.slice(0, 2).map(row => row.source), ['infojobs', 'jobtoday']);
assert.equal(rows.at(-1).source, 'sin fuente localizable');
// Los totales suman las filas y no cuentan el cajón de «sin fuente» como fuente.
const totals = scorecardTotals(rows);
assert.equal(totals.sources, 3, 'jobtoday, infojobs y remotive');
assert.equal(totals.ingested, 1500);
// Las enviadas reales incluyen la que no se pudo atribuir a una fuente (5 + 1).
assert.equal(totals.sent, 6);
assert.equal(totals.interviews, 2);
console.log('PASS  marcador por fuente: tasas por 1.000 anuncios vivos, huecos en «—» y ofertas sin fuente aparte');
