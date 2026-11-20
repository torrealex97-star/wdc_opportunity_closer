// Banco de preguntas de Formación: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training-quiz.mjs
import assert from 'node:assert/strict';
import { QUIZ_BY_COURSE, quizFor, quizPassMark, quizPassed } from '../../apps/web/lib/trainingQuiz';
import { TRAINING_COURSES } from '../../apps/web/lib/trainingCourses';
import { classLink, classLinkForLesson } from '../../apps/web/lib/skoolClass';

// Cada curso del Classroom tiene repaso: sin preguntas no se puede pedir a la alumna que demuestre nada.
const perCourse = TRAINING_COURSES.map(course => ({ id: course.id, questions: quizFor(course.id).length }));
for (const item of perCourse) assert.ok(item.questions >= 2, `${item.id}: al menos dos preguntas de repaso`);
assert.equal(perCourse.reduce((sum, item) => sum + item.questions, 0), 24, 'doce cursos por dos preguntas');

const ids = new Set();
for (const course of TRAINING_COURSES) {
  const questions = quizFor(course.id);
  for (const question of questions) {
    assert.ok(question.id.startsWith(`${course.id}-`), `${question.id}: el id nombra su curso`);
    assert.ok(!ids.has(question.id), `${question.id}: id repetido`);
    ids.add(question.id);
    assert.ok(question.prompt.length >= 20 && question.prompt.length <= 160, `${question.id}: enunciado de 20 a 160 caracteres`);
    assert.ok(question.prompt.endsWith('?') || question.prompt.endsWith(':') || question.prompt.endsWith('…'), `${question.id}: el enunciado se lee como pregunta`);
    assert.equal(question.options.length, 4, `${question.id}: cuatro opciones`);
    assert.equal(new Set(question.options).size, 4, `${question.id}: sin opciones repetidas`);
    for (const option of question.options) assert.ok(option.length >= 3 && option.length <= 90, `${question.id}: opción de 3 a 90 caracteres (${option})`);
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4, `${question.id}: índice correcto dentro de las opciones`);
    // La explicación devuelve a la clase: cita una sección de la skill y no promete resultados.
    assert.match(question.why, /§\d+/, `${question.id}: la explicación cita la sección de metodo-wdc`);
    assert.doesNotMatch(question.why, /garantiz|te aseguro|siempre funciona/i, `${question.id}: sin promesas de resultado`);
  }
}

// Ni una palabra del sistema comercial antiguo en el banco.
for (const questions of Object.values(QUIZ_BY_COURSE)) {
  for (const question of questions) {
    const text = `${question.prompt} ${question.options.join(' ')} ${question.why}`;
    assert.doesNotMatch(text, /BANT|pain cycle|BAMFAM|Decadere|Six Inches|Blueprint|scalix/i, `${question.id}: vocabulario de la academia`);
  }
}

// Aprobar el repaso: con dos preguntas hay que acertar las dos; 0/2 no vale lo mismo que 2/2.
assert.equal(quizPassMark(2), 2); assert.equal(quizPassMark(5), 4);
assert.equal(quizPassed(2, 2), true); assert.equal(quizPassed(1, 2), false); assert.equal(quizPassed(0, 2), false);
assert.equal(quizPassed(4, 5), true); assert.equal(quizPassed(3, 5), false); assert.equal(quizPassed(0, 0), false, 'sin preguntas no hay aprobado');
for (const course of TRAINING_COURSES) {
  const total = quizFor(course.id).length;
  assert.equal(quizPassed(total, total), true, `${course.id}: el repaso se puede aprobar`);
}

// Cada explicación devuelve a una clase real: la lección citada existe y su enlace sale de la hoja.
for (const course of TRAINING_COURSES) {
  for (const question of quizFor(course.id)) {
    const link = classLinkForLesson(question.lesson);
    assert.ok(link, `${question.id}: la lección ${question.lesson} existe en el Classroom`);
    assert.match(link.url, /^https:\/\/www\.skool\.com\/women-digital-closers\/classroom\/[0-9a-f]{8}/, `${question.id}: enlace real de Skool`);
    assert.equal(link.exact, true, `${question.id}: la clase citada tiene enlace propio, no el del módulo`);
  }
}
// Y si una lección no trae enlace, se abre el módulo y se dice qué buscar (no se inventa una URL).
const sampleCourse = TRAINING_COURSES[0];
const withoutOwnLink = classLink(sampleCourse, { ...sampleCourse.lessons[0], url: undefined });
assert.equal(withoutOwnLink.exact, false, 'sin enlace de lección se abre el módulo');
assert.equal(withoutOwnLink.url, sampleCourse.url, 'el respaldo es el enlace del módulo');
assert.match(withoutOwnLink.label, new RegExp(sampleCourse.lessons[0].title.split(' ')[0]), 'y el aviso dice qué clase buscar');

// El banco no se toca sin querer: si cambia una respuesta correcta, esto lo dice.
assert.equal(quizFor('gestion-de-las-objeciones')[0].correct, 1);
assert.equal(quizFor('estructura-de-la-llamada')[0].options[quizFor('estructura-de-la-llamada')[0].correct], 'Marco → cualificación → presentación → cierre');
assert.deepEqual(quizFor('no-existe'), [], 'un curso sin repaso devuelve lista vacía');

console.log('training-quiz: 24 preguntas OK en 12 cursos');
