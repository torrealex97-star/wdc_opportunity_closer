// Mide la recuperación del asistente contra el banco de preguntas reales, sin llamar al modelo.
// Uso:
//   node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/academy-retrieval.mjs
//   … --verbose   imprime una línea por pregunta con lo que se recuperó.
//
// Métricas:
//   · sección@1: el trozo correcto es el primero.
//   · sección@3: el trozo correcto está entre los tres primeros (lo que acaba citando la respuesta).
//   · lección@3: la lección esperada aparece en las lecciones de esos tres trozos.
//   · fuera de formación: no se recupera nada (ni se gasta una llamada al modelo).
import assert from 'node:assert/strict';
import { GOLDEN_QUESTIONS, HOLDOUT_QUESTIONS } from '../data/academy-golden.mjs';
import { retrieve } from '../../apps/web/lib/academyAssistant';

const verbose = process.argv.includes('--verbose');
// --holdout mide preguntas que no se usaron para ajustar nada: solo informa, no bloquea.
const holdout = process.argv.includes('--holdout');

const matchesSection = (chunkId, expected) => chunkId === expected || chunkId.startsWith(`${expected}--p`);

const rows = (holdout ? HOLDOUT_QUESTIONS : GOLDEN_QUESTIONS).map(item => {
  const hits = retrieve(item.question, 3);
  const inScope = !item.outOfScope;
  const sectionAt1 = inScope && hits.length > 0 && matchesSection(hits[0].chunk.id, item.section);
  const sectionAt3 = inScope && hits.some(hit => matchesSection(hit.chunk.id, item.section));
  const lessonAt3 = inScope && (item.lesson === null || hits.some(hit => hit.chunk.lessons.includes(item.lesson)));
  const silent = !inScope && hits.length === 0;
  return { ...item, hits, sectionAt1, sectionAt3, lessonAt3, silent };
});

const inScope = rows.filter(row => !row.outOfScope);
const outScope = rows.filter(row => row.outOfScope);
const pct = (value, total) => total ? `${Math.round((value / total) * 100)} % (${value}/${total})` : '—';
const section1 = inScope.filter(row => row.sectionAt1).length;
const section3 = inScope.filter(row => row.sectionAt3).length;
const lessonRows = inScope.filter(row => row.lesson !== null);
const lesson3 = lessonRows.filter(row => row.lessonAt3).length;
const silentOk = outScope.filter(row => row.silent).length;

if (holdout) {
  for (const row of rows) {
    console.log(`${row.sectionAt3 ? 'OK ' : 'NO '} ${row.id} · ${row.hits.map(hit => hit.chunk.id).join(' || ') || 'nada'}`);
  }
  console.log('');
}

if (verbose) {
  for (const row of rows) {
    const head = `${row.sectionAt3 ? 'OK ' : row.outOfScope ? (row.silent ? 'OK ' : 'NO ') : 'NO '} ${row.id}`;
    const got = row.hits.length ? row.hits.map(hit => `${hit.chunk.id} [${hit.score}]`).join(' || ') : 'nada';
    console.log(`${head} · "${row.question}"\n    esperado: ${row.section ?? 'nada'} · lección ${row.lesson ?? '—'}\n    obtenido: ${got}`);
  }
  console.log('');
}

console.log(`Preguntas: ${rows.length} (${inScope.length} en la formación, ${outScope.length} fuera)`);
console.log(`sección@1: ${pct(section1, inScope.length)}`);
console.log(`sección@3: ${pct(section3, inScope.length)}`);
console.log(`lección@3: ${pct(lesson3, lessonRows.length)}`);
console.log(`fuera de formación sin recuperar: ${pct(silentOk, outScope.length)}`);

// Umbrales: el asistente cita lo que recupera, así que un fallo de sección es una cita equivocada.
if (holdout) { console.log('academy-retrieval: holdout medido (sin umbral)'); process.exit(0); }
assert.ok(inScope.length >= 40, 'el banco necesita al menos 40 preguntas dentro de la formación');
assert.ok(section3 / inScope.length >= 0.85, `sección@3 por debajo del 85 %: ${pct(section3, inScope.length)}`);
assert.ok(lesson3 / lessonRows.length >= 0.85, `lección@3 por debajo del 85 %: ${pct(lesson3, lessonRows.length)}`);
assert.equal(silentOk, outScope.length, 'una pregunta fuera de la formación no debe recuperar nada');
console.log('academy-retrieval: PASS');
