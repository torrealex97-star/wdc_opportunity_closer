// Asistente de respuestas del formulario: piezas puras (validación de preguntas, evidencia sin datos
// de contacto y validación de lo que devuelve el modelo). Sin red: el modelo se simula con texto.
// Uso: node --experimental-strip-types tests/answer-assistant.mjs
import assert from 'node:assert/strict';
import { buildEvidence, buildMessages, cleanAnswers, parseQuestions } from '../apps/web/lib/answerAssistant.ts';

// 1) Pegar preguntas reales: numeración, viñetas, líneas en blanco y repetidas.
{
  const { questions, error } = parseQuestions('1. ¿Por qué quieres trabajar con nosotros?\n\n- ¿Cuál es tu mayor logro en ventas?\n• ¿Por qué quieres trabajar con nosotros?\n2) ¿Cómo gestionas un «no»?');
  assert.equal(error, null);
  assert.deepEqual(questions, ['¿Por qué quieres trabajar con nosotros?', '¿Cuál es tu mayor logro en ventas?', '¿Cómo gestionas un «no»?']);
}
// 2) Lo que no se puede responder no se manda: vacío, demasiado largo, demasiadas.
{
  assert.match(parseQuestions('   ').error ?? '', /al menos una/);
  assert.match(parseQuestions('x'.repeat(450)).error ?? '', /caracteres/);
  assert.match(parseQuestions(Array.from({ length: 12 }, (_, i) => `Pregunta ${i}`).join('\n')).error ?? '', /Máximo 10/);
  assert.ok(!parseQuestions(42).questions.length);
}
// 3) La evidencia excluye contacto y enlaces; solo viaja lo que sirve para redactar.
{
  const evidence = buildEvidence({ years_sales: 4, tools: ['HubSpot'], language_levels: { es: 'native' }, pitch: 'Cierro en frío.', city: 'Sevilla' }, { levels: { native: 'Nativo' }, contracts: { employee: 'Contrato laboral' } });
  assert.match(evidence, /Años de experiencia en ventas: 4/);
  assert.match(evidence, /HubSpot/);
  assert.match(evidence, /ES Nativo/);
  assert.ok(!/bea@ejemplo|600 ?11|linkedin|drive/i.test(evidence), 'sin email, teléfono ni enlaces');
  assert.equal(buildEvidence(null, { levels: {}, contracts: {} }), '');
}
// 4) Sin formulario compartido el prompt lo dice: respuestas genéricas y huecos declarados, no inventados.
{
  const messages = buildMessages({ company: 'Acme', role: 'Closer', questions: ['¿Por qué?'], evidence: '' });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /No inventes/);
  assert.match(messages[1].content, /No ha compartido su formulario/);
  assert.match(messages[1].content, /1\. ¿Por qué\?/);
}
// 5) Lo que devuelve el modelo se cruza con SUS preguntas: orden, sin duplicados y sin preguntas ajenas.
{
  const questions = ['¿Por qué?', '¿Mayor logro?'];
  const content = JSON.stringify({ answers: [
    { question: '¿Mayor logro?', answer: 'Subí el cierre un 20 %.', why: 'Dato concreto', missing: [] },
    { question: '¿Por qué?', answer: 'Vengo del frío.', why: 'Coherente con el puesto', missing: ['sector'] },
    { question: 'Pregunta inventada', answer: '...', why: '', missing: [] },
  ] });
  const cleaned = cleanAnswers(content, questions);
  assert.deepEqual(cleaned?.map(a => a.question), ['¿Por qué?', '¿Mayor logro?']);
  assert.deepEqual(cleaned?.[0].missing, ['sector']);
  assert.equal(cleanAnswers('no es json', questions), null);
  assert.equal(cleanAnswers(JSON.stringify({ answers: [] }), questions), null);
}
console.log('PASS  asistente de respuestas: preguntas normalizadas, evidencia sin contacto y salida del modelo validada contra lo que ella escribió');
