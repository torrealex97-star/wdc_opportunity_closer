#!/usr/bin/env node
// Asistente de la academia: el índice sale de la skill, la recuperación acierta la sección correcta y
// lo que no está en la formación NO se inventa (ni se gasta una llamada).
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/academy-assistant.mjs
import assert from 'node:assert/strict';
import {
  MAX_CHUNKS, NOT_IN_PROGRAMME, buildMessages, cleanAnswer, normalize, prepare, retrieve, tokenize,
} from '../../apps/web/lib/academyAssistant.ts';
import { WDC_KNOWLEDGE } from '../../apps/web/lib/wdcKnowledge.ts';
import { chunkSkill } from '../../scripts/wdc-knowledge.mjs';
import { readFileSync } from 'node:fs';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (error) { results.push(['FAIL', name, error.message.split('\n')[0]]); } };

const section = (item) => item.chunk.section;
const textOf = (item) => item.chunk.text.toLowerCase();

step('el índice es la skill entera, cortada y sin resumir', () => {
  assert.ok(WDC_KNOWLEDGE.length >= 50, `trozos: ${WDC_KNOWLEDGE.length}`);
  assert.ok(WDC_KNOWLEDGE.every((chunk) => chunk.text.length >= 40 && chunk.title && chunk.section), 'todo trozo tiene texto, título y sección');
  assert.ok(WDC_KNOWLEDGE.some((chunk) => /Mapa de la formación/i.test(chunk.section)), 'incluye el mapa del Classroom (§0)');
  for (const needle of ['Objeción', 'Seguimiento', 'Métricas', 'Captación']) {
    assert.ok(WDC_KNOWLEDGE.some((chunk) => chunk.text.includes(needle)), `incluye «${needle}»`);
  }
  // El texto del índice es el de la skill: la primera sección aparece literal.
  const skill = readFileSync(new URL('../../.agents/skills/metodo-wdc/SKILL.md', import.meta.url), 'utf8');
  assert.equal(chunkSkill(skill).length, WDC_KNOWLEDGE.length, 'el generador y el índice coinciden');
  assert.ok(!WDC_KNOWLEDGE.some((chunk) => /GENERADO desde/.test(chunk.text)), 'no se cuela la cabecera del fichero');
});

step('normaliza sin acentos y quita palabras vacías', () => {
  assert.equal(normalize('¿Qué hago si me dice que es MUY caro?'), 'que hago si me dice que es muy caro');
  const tokens = tokenize('¿Qué hago si me dice que es muy caro?');
  assert.ok(tokens.includes('caro') && tokens.includes('dice'), tokens.join(','));
  assert.ok(!tokens.includes('que') && !tokens.includes('muy'), 'sin palabras vacías');
});

step('la objeción de precio encuentra la lección 7.2, no un trozo cualquiera', () => {
  const hits = retrieve('¿qué hago si me dice que es muy caro?');
  assert.ok(hits.length, 'hay recuperación');
  const best = hits[0];
  assert.ok(/12|7/.test(section(best)), `sección inesperada: ${section(best)}`);
  assert.ok(hits.some((item) => textOf(item).includes('caro') || item.chunk.lessons.includes('7.2')), 'menciona el precio y su lección');
  assert.ok(hits.length <= MAX_CHUNKS, 'no se supera el tope de trozos');
});

step('pedir el cierre lleva a la sección de cierre', () => {
  const hits = retrieve('cómo pido el cierre y qué hago después del precio');
  assert.ok(hits.length, 'hay recuperación');
  assert.ok(hits.some((item) => /^11\./.test(section(item)) || item.chunk.lessons.includes('6.5')), hits.map(section).join(' | '));
});

step('«dónde se enseña X» usa el mapa del Classroom', () => {
  const hits = retrieve('¿dónde se enseña el silencio en la llamada?');
  assert.ok(hits.length, 'hay recuperación');
  assert.ok(hits.some((item) => /Mapa de la formación/i.test(item.chunk.section) || textOf(item).includes('9.7')), hits.map((item) => section(item)).join(' | '));
});

// Las cinco preguntas reales con las que se mide al asistente: la primera sección que recupera tiene que
// ser la que enseña eso, no una que repita la palabra. Si vuelve el falso amigo, este paso se pone rojo.
const REAL_QUESTIONS = [
  { id: 'miedo-al-no', question: '¿Qué hago si me da miedo que me diga que no?', sections: ['1-identidad-y-mentalidad--1-2-'], lesson: '3.2' },
  { id: 'brecha-numeros', question: '¿Cómo saco la brecha con números sin que parezca un interrogatorio?', sections: ['9-cualificacion', '7-psicologia-de-compra'], lesson: '6.3' },
  { id: 'confirmar-cita', question: '¿Cómo confirmo una llamada para que no me dejen plantada?', sections: ['13-seguimiento'], lesson: '8.4' },
  { id: 'objecion-pareja', question: 'Me dice que lo tiene que consultar con su pareja, ¿qué le contesto?', sections: ['12-objeciones--12-3-'], lesson: '7.5' },
  { id: 'orden-llamada', question: '¿Cuál es el orden de una llamada de ventas?', sections: ['8-estructura-de-la-llamada'], lesson: '6.1' },
];

step('las cinco preguntas reales citan su sección y su lección, no un falso amigo', () => {
  for (const row of REAL_QUESTIONS) {
    const hits = retrieve(row.question);
    assert.ok(hits.length, `${row.id}: no recupera nada`);
    const first = hits[0].chunk.id;
    assert.ok(row.sections.some((prefix) => first.startsWith(prefix)),
      `${row.id}: la primera cita es ${first}`);
    const lessons = new Set(hits.slice(0, 3).flatMap((item) => item.chunk.lessons));
    assert.ok(lessons.has(row.lesson), `${row.id}: no cita la lección ${row.lesson} (${[...lessons].join(', ')})`);
    const prepared = prepare(row.question);
    assert.ok(prepared.ok, `${row.id}: prepare la deja fuera de la formación`);
  }
  // Y sigue sin inventar: la pregunta ajena no entra.
  assert.equal(retrieve('receta de paella para cuatro personas').length, 0);
});

step('una pregunta fuera de la formación no recupera nada', () => {
  assert.equal(retrieve('receta de paella para cuatro personas').length, 0);
  assert.equal(retrieve('quién ganó la liga en 1998').length, 0);
});

step('prepare acota la pregunta y no deja pasar lo que no está', () => {
  assert.equal(prepare('').ok, false);
  assert.equal(prepare('corto').ok, false);
  assert.equal(prepare('x'.repeat(600)).ok, false);
  const outside = prepare('receta de paella para cuatro personas');
  assert.equal(outside.ok, false);
  assert.equal(outside.detail, NOT_IN_PROGRAMME);
  const inside = prepare('¿qué hago si dice que es caro?', { lessonTitle: 'Objeciones' });
  assert.ok(inside.ok && inside.retrieved.length >= 1, 'una pregunta de la formación sí pasa');
});

step('el prompt lleva los extractos, el vocabulario y las reglas', () => {
  const prepared = prepare('¿qué hago si dice que es caro?');
  assert.ok(prepared.ok);
  const messages = buildMessages(prepared.question, prepared.retrieved, { room: 'practica', lessonTitle: 'Objeciones y cierre' });
  const system = messages[0].content;
  const user = messages[1].content;
  assert.match(system, /SOLO con lo que dicen los extractos/);
  assert.match(system, /no prometas|Nada de promesas/i);
  assert.match(system, /módulo y lección/i);
  assert.match(user, /Pregunta de la alumna/);
  assert.match(user, /id=/);
  assert.match(user, /sala de práctica/);
});

step('cleanAnswer tira fuentes inventadas y respeta el «no está»', () => {
  const prepared = prepare('¿qué hago si dice que es caro?');
  assert.ok(prepared.ok);
  const real = prepared.retrieved[0].chunk.id;
  const clean = cleanAnswer(JSON.stringify({
    answer: 'Pregunta con qué lo compara antes de responder.',
    used_chunks: [real, 'inventado-que-no-existe'],
    in_programme: true,
  }), prepared.retrieved);
  assert.ok(clean, 'se parsea');
  assert.deepEqual(clean.sources.map((source) => source.id), [real]);
  assert.equal(clean.inProgramme, true);
  assert.equal(clean.nextStep, null);

  const outside = cleanAnswer(JSON.stringify({ answer: 'Eso no está en la formación.', used_chunks: [], in_programme: false }), prepared.retrieved);
  assert.ok(outside);
  assert.equal(outside.inProgramme, false);
  assert.ok(outside.nextStep, 'ofrece un siguiente paso');

  assert.equal(cleanAnswer('no es json', prepared.retrieved), null);
  assert.equal(cleanAnswer(JSON.stringify({ answer: '   ', used_chunks: [] }), prepared.retrieved), null);
});

const failed = results.filter(([status]) => status === 'FAIL');
for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
