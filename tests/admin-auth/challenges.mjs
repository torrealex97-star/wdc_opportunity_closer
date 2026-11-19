// Retos asignados: la forma del encargo y el estado derivado de `student_activity`.
// Nada se guarda aquí: se prueban funciones puras (y el estado NO es una columna).
import assert from 'node:assert/strict';
import { challengeProgress, challengeViews, checkChallengeInput } from '../../apps/web/lib/studentChallenges.ts';

const now = new Date('2026-11-19T10:00:00Z');
const challenge = {
  id: 'c1', org_id: 'cloud-wdc', student_id: 's1', scenario_id: 'objeciones-precio',
  min_score: 70, due_on: '2026-11-25', coach_note: 'Trabaja el precio sin rebajar.', created_by: 'coach@test.dev',
  created_at: '2026-11-19T09:00:00Z',
};
const practice = (score, at, ref = 'objeciones-precio') => ({ kind: 'practice', ref, score, detail: {}, created_at: at });
const progress = (activity, overrides = {}, when = now) => challengeProgress({ ...challenge, ...overrides }, activity, when);

// 1) Sin actividad: pendiente, sin intentos inventados (0 intentos es un dato; best null).
assert.deepEqual(progress([]), { status: 'pending', attempts: 0, best_score: null, completed_at: null, qualifying_score: null, late: false });

// 2) Práctica del escenario, antes del plazo y con la nota mínima: completado.
assert.deepEqual(progress([practice(75, '2026-11-20T18:00:00Z')]), { status: 'completed', attempts: 1, best_score: 75, completed_at: '2026-11-20T18:00:00Z', qualifying_score: 75, late: false });

// 3) Por debajo de la nota mínima no cumple; sigue pendiente y el intento se declara.
assert.deepEqual(progress([practice(65, '2026-11-20T18:00:00Z')]), { status: 'pending', attempts: 1, best_score: 65, completed_at: null, qualifying_score: null, late: false });

// 4) Sin nota mínima, cualquier práctica puntuada del escenario cumple.
assert.equal(progress([practice(10, '2026-11-20T18:00:00Z')], { min_score: null }).status, 'completed');

// 5) Otro escenario no cuenta (es una práctica distinta).
assert.equal(progress([practice(90, '2026-11-20T18:00:00Z', 'venta-fria')]).status, 'pending');
assert.equal(progress([practice(90, '2026-11-20T18:00:00Z', 'venta-fria')]).attempts, 0);

// 6) Una práctica anterior al encargo no cuenta (no se puede cumplir hacia atrás).
assert.equal(progress([practice(90, '2026-11-19T08:00:00Z')]).status, 'pending');

// 7) Pasado el plazo sin cumplir: fuera de plazo.
assert.equal(progress([practice(65, '2026-11-20T18:00:00Z')], {}, new Date('2026-11-26T10:00:00Z')).status, 'missed');

// 8) Cumplió la nota pero después del plazo: se declara `late`, no se aprueba tarde.
const late = progress([practice(80, '2026-11-26T18:00:00Z')], {}, new Date('2026-11-27T10:00:00Z'));
assert.equal(late.status, 'missed'); assert.equal(late.late, true); assert.equal(late.best_score, 80); assert.equal(late.completed_at, null);

// 9) Frontera de Madrid: el plazo es el día 25; a las 23:30Z ya es día 26 en Madrid y no cuenta.
const madrid = (at) => progress([practice(80, at)], {}, new Date('2026-11-26T10:00:00Z'));
assert.equal(madrid('2026-11-25T22:00:00Z').status, 'completed', '22:00Z del 25 aún es el 25 en Madrid');
assert.equal(madrid('2026-11-25T23:30:00Z').status, 'missed', '23:30Z del 25 ya es el 26 en Madrid');
assert.equal(madrid('2026-11-25T23:30:00Z').late, true);

// 10) Sin lectura de actividad el estado es «—» (unknown) y los intentos son null, no cero.
const unknown = challengeViews([challenge], null, now)[0];
assert.equal(unknown.status, 'unknown'); assert.equal(unknown.attempts, null); assert.equal(unknown.best_score, null);
assert.equal(unknown.scenario.title, '«Me parece caro» a mitad de la propuesta'); assert.equal(unknown.scenario.track, 'llamada');
assert.equal(challengeViews([challenge], [], now)[0].status, 'pending');

// 11) Validación del encargo: escenario del catálogo, nota 1–100 o vacía, plazo real de hoy a un año, nota 1–500.
const valid = checkChallengeInput({ scenario_id: 'objeciones-precio', min_score: 70, due_on: '2026-11-25', coach_note: '  Trabaja el precio.  ' }, now);
assert.deepEqual(valid, { ok: true, value: { scenario_id: 'objeciones-precio', min_score: 70, due_on: '2026-11-25', coach_note: 'Trabaja el precio.' } });
assert.deepEqual(checkChallengeInput({ scenario_id: 'entrevista-closer', min_score: '', due_on: '2026-11-19', coach_note: 'Cuenta cifras.' }, now).value.min_score, null);
for (const body of [
  { scenario_id: 'inventado', min_score: 70, due_on: '2026-11-25', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', min_score: 0, due_on: '2026-11-25', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', min_score: 101, due_on: '2026-11-25', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', min_score: 70.5, due_on: '2026-11-25', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', due_on: '2026-11-18', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', due_on: '2026-02-30', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', due_on: '2027-12-31', coach_note: 'x' },
  { scenario_id: 'objeciones-precio', due_on: '2026-11-25', coach_note: '   ' },
  { scenario_id: 'objeciones-precio', due_on: '2026-11-25', coach_note: 'a'.repeat(501) },
  { scenario_id: 'objeciones-precio', due_on: '2026-11-25' },
]) assert.equal(checkChallengeInput(body, now).ok, false, JSON.stringify(body).slice(0, 90));

// 12) La nota se sanea (sin HTML) pero conserva su contenido; un correo no se convierte en dato personal visible.
const clean = checkChallengeInput({ scenario_id: 'venta-fria', due_on: '2026-11-25', coach_note: '<b>Hola</b>  escribe a coach@test.dev' }, now);
assert.equal(clean.ok, true); assert.equal(clean.value.coach_note, 'Hola escribe a [correo omitido]');

console.log('challenges OK: 12 bloques');
