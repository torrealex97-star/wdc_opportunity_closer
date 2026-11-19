// Criterios de práctica alineados con las skills `analisis-llamadas-ventas` y `scalix-ventas`:
// pesos por fase, BANT con evidencia, UNA corrección prioritaria y edición desde el panel sin
// romper las notas. node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice-rubrics.mjs
import assert from 'node:assert/strict';
import {
  DEFAULT_BANT, DEFAULT_PRIORITIES, DEFAULT_RUBRICS, MAX_AXES, ROOMS,
  allAxisLabels, axesForRoom, roomOf, validateBant, validatePriorities, validateRubrics, weightedScore,
} from '../../apps/web/lib/practiceRubrics.ts';
import { axesFor, debriefInstructions, debriefSchema, needsBant } from '../../apps/web/app/api/practice/prompts.ts';
import { cleanDebrief } from '../../apps/web/app/api/practice/debrief.ts';
import { analyzeSignals } from '../../apps/web/app/api/practice/signals.ts';
import { scenarioById } from '../../apps/web/components/practiceScenarios.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const closer = scenarioById('llamada-completa');
const setter = scenarioById('setter-inbound');
const frio = scenarioById('frio-apertura');
const interview = scenarioById('perfil-directo');
const clone = value => JSON.parse(JSON.stringify(value));
const weights = room => Object.fromEntries(DEFAULT_RUBRICS[room].map(axis => [axis.id, axis.weight]));

await step('las cinco rúbricas son válidas y los pesos suman 100', () => {
  const checked = validateRubrics(DEFAULT_RUBRICS);
  assert.ok(checked.ok, checked.ok ? '' : checked.detail);
  for (const room of ROOMS) {
    const axes = DEFAULT_RUBRICS[room.id];
    assert.ok(axes.length >= 3 && axes.length <= MAX_AXES, room.id);
    assert.equal(axes.reduce((sum, axis) => sum + axis.weight, 0), 100, `${room.id}: pesos`);
    for (const axis of axes) assert.ok(axis.label && axis.guide && axis.weight >= 1, `${room.id}/${axis.id}`);
  }
});

await step('el closer usa las fases y pesos de la skill (10/25/10/15/30/5/5)', () => {
  assert.deepEqual(weights('venta'), { apertura: 10, descubrimiento: 25, pitch: 10, control: 15, objecion: 30, siguiente: 5, etica: 5 });
  assert.equal(roomOf('venta'), 'venta');
  assert.equal(roomOf('entrevista', 'wdc-entrevista'), 'wdc-entrevista');
  // Setter, frío y entrevista se reasignan según rubrica.md §1 (no se recicla la rúbrica del closer).
  assert.deepEqual(weights('setter'), { apertura: 15, cualificacion: 30, agenda: 25, control: 15, traspaso: 10, etica: 5 });
  assert.deepEqual(weights('frio'), { apertura: 35, control: 15, siguiente: 30, objecion: 15, etica: 5 });
  assert.equal(DEFAULT_RUBRICS.entrevista.length, 5);
});

await step('la validación rechaza una rúbrica rota en vez de arreglarla a medias', () => {
  const duplicate = clone(DEFAULT_RUBRICS); duplicate.venta[1].id = 'apertura';
  assert.equal(validateRubrics(duplicate).ok, false);
  const zero = clone(DEFAULT_RUBRICS); zero.venta[0].weight = 0;
  assert.equal(validateRubrics(zero).ok, false);
  const empty = clone(DEFAULT_RUBRICS); empty.setter[0].guide = '   ';
  assert.equal(validateRubrics(empty).ok, false);
  const tooMany = clone(DEFAULT_RUBRICS); tooMany.frio.push({ id: 'extra_1', label: 'X', guide: 'Y', weight: 1 });
  tooMany.frio.push({ id: 'extra_2', label: 'X2', guide: 'Y2', weight: 1 });
  tooMany.frio.push({ id: 'extra_3', label: 'X3', guide: 'Y3', weight: 1 });
  tooMany.frio.push({ id: 'extra_4', label: 'X4', guide: 'Y4', weight: 1 });
  assert.equal(validateRubrics(tooMany).ok, false);
  assert.equal(validateRubrics({ ...DEFAULT_RUBRICS, venta: [] }).ok, false);
  const badId = clone(DEFAULT_RUBRICS); badId.venta[0].id = 'Apertura!';
  assert.equal(validateRubrics(badId).ok, false);
  assert.equal(validateBant({ venta: true }).ok, false);
  assert.equal(validatePriorities(['']).ok, false);
  assert.equal(validatePriorities(['a', 'a']).ok, false);
});

await step('la nota es la media ponderada (los pesos cambian el resultado y se normalizan)', () => {
  const rubric = DEFAULT_RUBRICS.venta;
  const all80 = rubric.map(axis => ({ id: axis.id, score: 80 }));
  assert.equal(weightedScore(all80, rubric), 80);
  const onlyApertura = rubric.map(axis => ({ id: axis.id, score: axis.id === 'apertura' ? 100 : 0 }));
  assert.equal(weightedScore(onlyApertura, rubric), 10);
  const onlyClose = rubric.map(axis => ({ id: axis.id, score: axis.id === 'objecion' ? 100 : 0 }));
  assert.equal(weightedScore(onlyClose, rubric), 30);
  // Pesos que no suman 100 se normalizan: no hay que cuadrar la escala para probar un cambio.
  const custom = [{ id: 'a', label: 'A', guide: 'G', weight: 1 }, { id: 'b', label: 'B', guide: 'G', weight: 3 }, { id: 'c', label: 'C', guide: 'G', weight: 4 }];
  assert.equal(weightedScore([{ id: 'a', score: 100 }, { id: 'b', score: 50 }, { id: 'c', score: 0 }], custom), 31);
});

await step('lo que edita el panel entra en el prompt y en el esquema', () => {
  const custom = clone(DEFAULT_RUBRICS);
  custom.venta[0].label = 'Apertura con prueba social';
  custom.venta[0].weight = 13;
  custom.venta[0].guide = 'Abre con una prueba de un caso idéntico y pide permiso.';
  const axis = axesFor(closer, custom);
  assert.equal(axis[0].label, 'Apertura con prueba social');
  const instructions = debriefInstructions(closer, null, custom, ['Regla propia del panel.']);
  assert.match(instructions, /Abre con una prueba de un caso idéntico/);
  assert.match(instructions, /peso 13%/);
  assert.match(instructions, /1\. Regla propia del panel\./);
  const schema = debriefSchema(closer, custom);
  assert.ok(schema.properties.axes.items.properties.id.enum.includes('apertura'));
  assert.ok(!debriefSchema(closer, custom).properties.axes.items.properties.id.enum.includes('marco'));
});

await step('BANT solo se pide en las salas de venta y el prompt explica la vara', () => {
  assert.ok(needsBant(closer) && needsBant(setter) && needsBant(frio));
  assert.equal(needsBant(interview), false);
  assert.ok(debriefSchema(closer).required.includes('bant'));
  assert.ok(!debriefSchema(interview).required.includes('bant'));
  assert.equal(debriefSchema(interview).properties.bant, undefined);
  assert.match(debriefInstructions(setter), /Auditoría BANT/);
  assert.doesNotMatch(debriefInstructions(interview), /Auditoría BANT/);
  assert.equal(DEFAULT_BANT.entrevista, false);
});

await step('la prioridad manda en el orden de la skill y el feedback no pide varias', () => {
  assert.match(DEFAULT_PRIORITIES[0], /pain cycle/i);
  const instructions = debriefInstructions(closer, null, DEFAULT_RUBRICS, DEFAULT_PRIORITIES);
  const first = instructions.indexOf('1. No hubo pain cycle');
  const later = instructions.indexOf('2. BANT, decisor o momento');
  assert.ok(first > 0 && later > first, 'orden de prioridades');
  assert.match(instructions, /LA CORRECCIÓN PRIORITARIA, una sola/);
  assert.match(instructions, /next: una sola tarea para las próximas 24 horas/);
  for (const scenario of [closer, setter, frio, interview]) assert.ok(axesFor(scenario).length >= 4);
});

const turns = [
  { role: 'user', content: 'Hola Marta, soy Ana. ¿Te importa que te haga una pregunta? Vi que perdéis seguimientos por correo.' },
  { role: 'coach', content: 'Dime, aunque tengo cinco minutos.' },
  { role: 'user', content: 'Entiendo que se te escapan clientes que ya habían dicho que sí. ¿Cuántas citas crees que se caen al mes por eso?' },
  { role: 'coach', content: 'Mi socia y yo decidimos esto juntos. Se nos caen unas diez citas al mes y cada una vale unos 2.000 euros.' },
  { role: 'user', content: 'Entonces el coste de seguir igual es de unos 20.000 euros al mes, ¿es así? ¿Y cuándo queréis resolverlo?' },
  { role: 'coach', content: 'Sí, es así. Este trimestre tenemos que arreglarlo.' },
];

function payload(overrides = {}) {
  const axes = DEFAULT_RUBRICS.venta.map(axis => ({ id: axis.id, score: 80, note: 'Nota con evidencia.', quote: '¿Te importa que te haga una pregunta?' }));
  return JSON.stringify({
    summary: 'Llamada ordenada, con descubrimiento antes del pitch.',
    focus: 'Cerrar con día y hora.',
    strengths: ['Abre con permiso'],
    improvements: ['Pide la reunión'],
    axes,
    model: 'Ana, ¿lo dejamos el jueves a las diez?',
    next: 'Agenda una llamada con dos huecos concretos.',
    bant: {
      budget: { status: '~', quote: 'cada una vale unos 2.000 euros' },
      authority: { status: '✗', quote: 'Mi socia y yo decidimos esto juntos' },
      need: { status: '✓', quote: 'se nos caen unas diez citas al mes' },
      timing: { status: '✓', quote: 'Este trimestre tenemos que arreglarlo' },
      decision: 'avanzar_sin_cualificar',
    },
    ...overrides,
  });
}

await step('el feedback acepta BANT con evidencia del interlocutor y conserva la nota ponderada', () => {
  const debrief = cleanDebrief(payload(), turns, closer);
  assert.ok(debrief);
  assert.equal(debrief.score, 80);
  assert.equal(debrief.bant.authority.status, '✗');
  assert.equal(debrief.bant.budget.quote, 'cada una vale unos 2.000 euros');
  assert.equal(debrief.bant.decision, 'avanzar_sin_cualificar');
  assert.equal(debrief.axes.length, 7);
});

await step('una cita inventada se borra; una decisión o un estado fuera de la tabla rechazan el feedback', () => {
  const invented = JSON.parse(payload());
  invented.bant.need.quote = 'Necesitamos esto para ayer';
  invented.axes[0].quote = 'Frase que la alumna nunca dijo';
  const debrief = cleanDebrief(JSON.stringify(invented), turns, closer);
  assert.equal(debrief.bant.need.quote, '');
  assert.equal(debrief.axes[0].quote, '');
  assert.equal(cleanDebrief(payload({ bant: { ...JSON.parse(payload()).bant, decision: 'quizas' } }), turns, closer), null);
  const badStatus = JSON.parse(payload()); badStatus.bant.need.status = 'OK';
  assert.equal(cleanDebrief(JSON.stringify(badStatus), turns, closer), null);
  const missing = JSON.parse(payload()); delete missing.bant;
  assert.equal(cleanDebrief(JSON.stringify(missing), turns, closer), null);
});

await step('una entrevista no exige BANT y conserva sus cinco criterios', () => {
  const generic = scenarioById('entrevista-closer');
  const interviewPayload = JSON.parse(payload());
  delete interviewPayload.bant;
  interviewPayload.axes = DEFAULT_RUBRICS.entrevista.map(axis => ({ id: axis.id, score: 70, note: '', quote: '' }));
  const debrief = cleanDebrief(JSON.stringify(interviewPayload), turns, generic);
  assert.ok(debrief);
  assert.equal(debrief.bant, undefined);
  assert.equal(debrief.axes.length, 5);
  // La variante WDC mantiene sus seis criterios con peso.
  const wdc = JSON.parse(payload());
  wdc.axes = DEFAULT_RUBRICS['wdc-entrevista'].map(axis => ({ id: axis.id, score: 70, note: '', quote: '' }));
  const wdcDebrief = cleanDebrief(JSON.stringify(wdc), turns, interview);
  assert.ok(wdcDebrief);
  assert.equal(wdcDebrief.axes.length, 6);
  assert.equal(wdcDebrief.bant, undefined);
});

await step('las señales nuevas miden ratio de habla y precio antes de descubrir', () => {
  const talkative = analyzeSignals([
    { role: 'user', content: 'Te cuento cómo funciona nuestro programa y todo lo que incluye para que puedas decidir sin dudas, con detalle de cada módulo, cada sesión y cada herramienta, y también cómo lo aplicamos en casos como el tuyo para que veas el resultado.' },
    { role: 'coach', content: 'Vale.' },
    { role: 'user', content: 'Además incluimos seguimiento semanal, plantillas, grabaciones y una comunidad con más de mil personas para que no te sientas sola en ningún momento del proceso y puedas preguntar lo que quieras.' },
    { role: 'user', content: 'Y si quieres te cuento también cómo funciona el acompañamiento diario, los horarios de las sesiones en directo, las grabaciones que quedan disponibles para siempre y la forma de contactar con el equipo cuando tengas cualquier duda durante la semana, además de los materiales extra que recibes al empezar y el calendario completo de las primeras seis semanas.' },
  ], 'venta');
  assert.ok(talkative.some(signal => signal.id === 'hablas'));

  const price = analyzeSignals([
    { role: 'user', content: 'Hola, el programa cuesta 2.400 euros y ahora te explico por qué.' },
    { role: 'coach', content: 'Vale, dime.' },
    { role: 'user', content: 'Incluye seis semanas de acompañamiento y plantillas.' },
  ], 'venta');
  assert.ok(price.some(signal => signal.id === 'precio-antes'));
  // La entrevista no mide precio ni suma de apertura sumisa.
  assert.ok(!analyzeSignals([{ role: 'user', content: 'Gracias por su tiempo, el salario que pido son 30.000 euros.' }], 'entrevista').some(signal => ['precio-antes', 'sumision'].includes(signal.id)));
});

await step('el mapa de etiquetas cubre los ejes de todas las rúbricas', () => {
  const labels = allAxisLabels();
  for (const room of ROOMS) for (const axis of DEFAULT_RUBRICS[room.id]) assert.ok(labels[axis.id], `${room.id}/${axis.id}`);
  assert.equal(axesForRoom('venta')[0].id, 'apertura');
});

for (const [status, name, detail] of results) console.log(status, ' ', name, detail ?? '');
const bad = results.filter(result => result[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
