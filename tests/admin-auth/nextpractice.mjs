// «Tu siguiente práctica» es una decisión determinista sobre datos que ya existen: eje más flojo (con al
// menos 3 prácticas), categoría menos practicada de esa sala y días desde la última práctica (Madrid).
// Mismos datos → misma recomendación; no hay azar ni modelo.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/nextpractice.mjs
import assert from 'node:assert/strict';
import { MIN_AXIS_SAMPLES, daysSince, nextPractice } from '../../apps/web/lib/nextPractice.ts';

const scenarios = [
  { id: 'a1', track: 'llamada', category: 'inicio', title: 'A1' },
  { id: 'a2', track: 'llamada', category: 'inicio', title: 'A2' },
  { id: 'b1', track: 'llamada', category: 'objeciones', title: 'B1' },
  { id: 'c1', track: 'llamada', category: 'completa', title: 'C1' },
  { id: 'e1', track: 'entrevista', category: 'responsable', title: 'E1' },
  { id: 'e2', track: 'entrevista', category: 'rrhh', title: 'E2' },
];
const now = new Date('2026-11-18T12:00:00Z');
const pick = (axes, mastery = [], lastPracticeAt = null) => nextPractice(scenarios, { axes, mastery, lastPracticeAt }, now);

// El eje con 2 prácticas no es una media todavía: se ignora al elegir.
let choice = pick([
  { axis: 'cierre', avg: 40, count: 4, track: 'llamada' },
  { axis: 'encaje', avg: 10, count: 2, track: 'entrevista' },
], [{ ref: 'b1', count: 9 }]);
assert.equal(choice.track, 'llamada');
assert.deepEqual(choice.weakest, { axis: 'cierre', avg: 40, count: 4 });
// Categoría menos practicada de esa sala (inicio, 0 veces) y primer escenario de la categoría en el catálogo.
assert.equal(choice.category, 'inicio');
assert.equal(choice.scenario.id, 'a1');
assert.equal(choice.categoryCount, 0);

// Empate de media: decide el nombre del eje, no el orden en que llegaron los datos.
choice = pick([
  { axis: 'objecion', avg: 50, count: 3, track: 'llamada' },
  { axis: 'confianza', avg: 50, count: 3, track: 'entrevista' },
]);
assert.equal(choice.weakest.axis, 'confianza');
assert.equal(choice.track, 'entrevista');
assert.equal(choice.category, 'responsable');

// Sin ejes con 3 datos: la sala con menos prácticas de siempre y su categoría menos tocada.
choice = pick([{ axis: 'cierre', avg: 10, count: 2, track: 'llamada' }], [
  { ref: 'a1', count: 5 }, { ref: 'b1', count: 4 }, { ref: 'c1', count: 1 },
  { ref: 'e1', count: 2 }, { ref: 'e2', count: 0 },
]);
assert.equal(choice.track, 'entrevista');
assert.equal(choice.category, 'rrhh');
assert.equal(choice.scenario.id, 'e2');
assert.equal(choice.weakest, null);

// Días de calendario en Madrid: las 23:30 UTC y las 00:10 UTC ya son el mismo día 19 (en UTC no lo serían).
assert.equal(daysSince('2026-11-12T09:00:00Z', now), 6);
assert.equal(daysSince('2026-11-18T23:30:00Z', new Date('2026-11-19T00:10:00Z')), 0);
assert.equal(daysSince('2026-11-18T23:30:00Z', new Date('2026-11-19T22:10:00Z')), 0);
assert.equal(daysSince('2026-11-18T23:30:00Z', new Date('2026-11-21T10:00:00Z')), 2);
assert.equal(daysSince(null, now), null);
assert.equal(pick([], [], '2026-11-12T09:00:00Z').days, 6);

// Sin catálogo no hay recomendación; sin historial, la primera situación del catálogo y ningún día inventado.
assert.equal(nextPractice([], { axes: [], mastery: [], lastPracticeAt: null }, now), null);
choice = nextPractice(scenarios, { axes: [], mastery: [], lastPracticeAt: null }, now);
assert.equal(choice.scenario.id, 'a1');
assert.equal(choice.days, null);
assert.equal(MIN_AXIS_SAMPLES, 3);

console.log('PASS  siguiente práctica: eje flojo con 3+ datos, categoría menos practicada y días en Madrid, sin azar');
