// «¿Dónde se enseña esto?» sobre el mapa del Classroom: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/classroom-search.mjs
// Sin modelo y sin red: solo el índice de la skill (§0.2 y §0.3) cruzado con la hoja de formación.
import assert from 'node:assert/strict';
import { CLASSROOM_MODULES, CLASSROOM_TOPICS, CLASSROOM_TOTALS } from '../../apps/web/lib/classroomMap';
import { normalizeClassroom, stem, terms, whereTaught } from '../../apps/web/lib/classroomSearch';
import { TRAINING_COURSES } from '../../apps/web/lib/trainingCourses';

let n = 0; const ok = (name) => { n += 1; console.log(`PASS  ${name}`); };

// 1. El índice está completo y es el de la skill: 12 módulos, 130 lecciones, 64 temas.
assert.deepEqual(CLASSROOM_TOTALS, { modules: 12, lessons: 130, topics: 64 });
assert.deepEqual(CLASSROOM_MODULES.map(m => m.lessons).reduce((a, b) => a + b, 0), 130, 'los módulos suman 130 lecciones');
assert.deepEqual(CLASSROOM_MODULES.map(m => m.order), Array.from({ length: 12 }, (_, i) => i + 1), 'módulos del 1 al 12');
const lessonIds = new Set(TRAINING_COURSES.flatMap(course => course.lessons.map(lesson => lesson.id)));
for (const topic of CLASSROOM_TOPICS) {
  assert.ok(topic.lessons.length > 0, `${topic.topic}: el mapa dice en qué clase se enseña`);
  for (const id of topic.lessons) assert.ok(lessonIds.has(id), `${topic.topic}: la lección ${id} existe en la hoja`);
}
ok('12 módulos, 130 lecciones y 64 temas; cada tema apunta a una lección real');

// 2. Normalización y raíz: lo que hace que «objeción» encuentre «objeciones», sin diccionario.
assert.equal(normalizeClassroom('¿Objeción de PAREJA?'), 'objecion de pareja');
assert.equal(stem('objeciones'), 'objecion'); assert.equal(stem('objecion'), 'objecion');
assert.deepEqual(terms('¿Dónde se enseña la objeción de pareja?').includes('pareja'), true, 'las palabras vacías no cuentan');
assert.ok(terms('no-show').some(term => term.startsWith('confirm')) && terms('no-show').includes('llamada'), '«no-show» se traduce a confirmar la llamada');
ok('normaliza acentos y guiones, quita palabras vacías y recorta plurales');

// 3. Casos fijos: la primera clase es la que de verdad lo enseña.
const first = (query) => whereTaught(query, 3)[0]?.lesson.id ?? null;
for (const [query, lesson] of [
  ['¿Dónde se enseña la objeción de pareja?', '7.5'],
  ['no-show', '8.4'],
  ['¿cómo confirmo la cita?', '8.4'],
  ['vídeo de presentación', '11.7'],
  ['psicología del precio', '2.4'],
  ['currículum', '11.2'],
  ['dolor superficial', '5.2'],
  ['es muy caro', '7.2'],
  ['las métricas de la closer', '8.6'],
  ['cómo cerrar sin bajar el precio', '2.8'],
  ['cualificación profunda', '6.3'],
]) {
  assert.equal(first(query), lesson, `«${query}» → ${lesson}`);
}
ok('once preguntas reales caen en su clase');

// 4. Cada resultado trae módulo, lección, duración y recurso (o «solo vídeo», nunca un hueco mudo).
const sample = whereTaught('objeción de pareja', 3);
assert.ok(sample.length >= 1);
for (const result of sample) {
  assert.ok(result.module.order >= 1 && result.module.order <= 12);
  assert.ok(result.module.name.length > 3, 'el módulo tiene nombre');
  assert.match(result.lesson.duration, /^\d+:\d{2}:\d{2}$/, `${result.lesson.id}: duración con formato de la hoja`);
  assert.ok(result.resource === null || /^https:\/\//.test(result.resource.url), 'el recurso o es un enlace real o no hay material');
  assert.ok(result.skool === null || result.skool.startsWith('https://www.skool.com/'), 'la clase se abre en Skool');
  assert.match(result.lesson.id, /^\d{1,2}\.\d{1,2}$/);
}
assert.equal(whereTaught('no-show')[0].resource, null, '8.4 es solo vídeo y se dice así, sin inventar material');
ok('módulo, lección, duración y recurso en cada resultado');

// 5. Determinista: el mismo texto da siempre lo mismo, y lo que no está no se inventa.
const twice = [whereTaught('objeciones'), whereTaught('objeciones')];
assert.deepEqual(twice[0], twice[1]);
assert.deepEqual(whereTaught('paella valenciana'), [], 'un tema ajeno no devuelve clases');
assert.deepEqual(whereTaught('   '), [], 'sin palabras no hay búsqueda');
assert.ok(whereTaught('objeciones', 2).length <= 2, 'el límite se respeta');
assert.ok(whereTaught('objeciones').length <= 5, 'como mucho cinco clases por búsqueda');
ok('determinista, acotado y sin inventar cuando el mapa no lo tiene');

console.log(`classroom-search: ${n}/5 OK (${CLASSROOM_TOTALS.topics} temas)`);
