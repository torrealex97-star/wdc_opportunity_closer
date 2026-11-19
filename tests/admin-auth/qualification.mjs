// Test del formulario de cualificación: ocho preguntas con una respuesta que se lee con
// autoridad, dos que restan o quedan cortas, y una revisión de la presentación libre con
// reglas explicables. Sin IA, sin red y sin guardar nada.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/qualification.mjs
import assert from 'node:assert/strict';
import { AUTHORITY_RULES, FORM_QUESTIONS, formBand, gradeForm, reviewPitch } from '../../apps/web/components/qualificationForm.ts';

// 1) El formulario es corregible: tres opciones por pregunta, ids únicos y una sola respuesta de autoridad.
assert.ok(FORM_QUESTIONS.length >= 8, 'al menos ocho preguntas');
for (const question of FORM_QUESTIONS) {
  assert.equal(question.options.length, 3, `${question.id}: tres opciones`);
  assert.equal(new Set(question.options.map(option => option.id)).size, 3, `${question.id}: ids únicos`);
  assert.equal(question.options.filter(option => option.grade === 2).length, 1, `${question.id}: una respuesta de autoridad`);
  assert.ok(question.options.every(option => option.text.length >= 30 && option.reads.length >= 40), `${question.id}: texto y lectura explicados`);
  assert.ok(question.wants.length > 40, `${question.id}: dice qué comprueba quien contrata`);
}
// Las reglas de autoridad son cinco y se explican solas.
assert.equal(AUTHORITY_RULES.length, 5);
assert.ok(AUTHORITY_RULES.every(rule => rule.title && rule.text.length > 60));

const best = Object.fromEntries(FORM_QUESTIONS.map(question => [question.id, question.options.find(option => option.grade === 2).id]));
const worst = Object.fromEntries(FORM_QUESTIONS.map(question => [question.id, question.options.find(option => option.grade === 0).id]));
const middle = Object.fromEntries(FORM_QUESTIONS.map(question => [question.id, question.options.find(option => option.grade === 1).id]));

// 2) La nota sale de las respuestas elegidas, no de su orden: todo autoridad 100, todo flojo 0, todo intermedio 50.
const top = gradeForm(best);
assert.equal(top.score, 100); assert.equal(top.strong, FORM_QUESTIONS.length); assert.deepEqual(top.weak, []);
assert.equal(top.points, top.max);
assert.equal(gradeForm(worst).score, 0);
assert.equal(gradeForm(worst).weak.length, FORM_QUESTIONS.length);
assert.equal(gradeForm(middle).score, 50);
// Una pregunta sin responder no cuenta como acierto ni como fallo inventado: baja la nota y no entra en `weak`.
const partial = gradeForm({ [FORM_QUESTIONS[0].id]: best[FORM_QUESTIONS[0].id] });
assert.equal(partial.points, 2); assert.equal(partial.strong, 1); assert.deepEqual(partial.weak, []);
assert.ok(partial.score < 100);

// 3) La banda describe cómo se lee el formulario, sin aprobar ni suspender a nadie.
assert.equal(formBand(100).level, 'autoridad');
assert.equal(formBand(80).level, 'autoridad');
assert.equal(formBand(79).level, 'prudente');
assert.equal(formBand(50).level, 'prudente');
assert.equal(formBand(49).level, 'oportunidad');
assert.ok(formBand(0).detail.length > 60);

// 4) La presentación libre: una respuesta con cifra, rol, método y sin disculpas cumple todos los criterios.
const good = reviewPitch('Cierro software de gestión a clínicas pequeñas. Primero pregunto cómo hacen el seguimiento, luego muestro solo lo que encaja y cierro con una fecha. En 2025 cerré 14 cuentas de 900 € al mes con 60 llamadas.');
assert.equal(good.filter(item => item.ok).length, good.length, 'la presentación completa cumple todo');
// La misma respuesta pidiendo perdón por ser nueva y sin cifras falla en lo que importa.
const weak = reviewPitch('No tengo experiencia, solo soy una persona trabajadora con muchas ganas y me apasiona la gente.');
const failed = new Set(weak.filter(item => !item.ok).map(item => item.id));
for (const id of ['cifra', 'rol', 'metodo', 'sin-disculpas']) assert.ok(failed.has(id), `debe faltar ${id}`);
// Una cifra imposible resta credibilidad aunque el resto esté bien.
const inflated = reviewPitch('Cierro el 100 % de lo que me ponen delante. Primero pregunto y luego cierro; siempre cierro.');
assert.equal(inflated.find(item => item.id === 'sin-inflar').ok, false);
// Sin texto no se cumple nada, y no se inventa un aprobado.
assert.ok(reviewPitch('').every(item => !item.ok));

console.log('PASS  formulario de cualificación: tres respuestas por pregunta, nota determinista y presentación revisada con reglas explicables');
