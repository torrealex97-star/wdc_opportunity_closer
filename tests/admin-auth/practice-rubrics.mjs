// Criterios de práctica alineados con las skills `analisis-llamadas-ventas` y `scalix-ventas`:
// pesos por fase, BANT con evidencia, UNA corrección prioritaria y edición desde el panel sin
// romper las notas. node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice-rubrics.mjs
import assert from 'node:assert/strict';
import {
  DEFAULT_BANT, DEFAULT_PRIORITIES, DEFAULT_RUBRICS, MAX_AXES, ROOMS,
  allAxisLabels, axesForRoom, diffPracticeConfig, roomOf, validateBant, validatePriorities, validateRubrics, weightedScore,
} from '../../apps/web/lib/practiceRubrics.ts';
import { axesFor, debriefInstructions, debriefSchema, needsBant } from '../../apps/web/app/api/practice/prompts.ts';
import { cleanDebrief } from '../../apps/web/app/api/practice/debrief.ts';
import { analyzeSignals } from '../../apps/web/lib/practiceSignals.ts';
import { scenarioById } from '../../apps/web/components/practiceScenarios.ts';
import { CALL_REVIEW_SCENARIO, callReviewScenario, parseCallTranscript } from '../../apps/web/lib/callReview.ts';
import { detectCallType, resolveCallType } from '../../apps/web/lib/callType.ts';

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
    for (const axis of axes) {
      assert.ok(axis.label && axis.guide && axis.weight >= 1, `${room.id}/${axis.id}`);
      assert.equal(axis.enabled, true, `${room.id}/${axis.id}: activo por defecto`);
      assert.ok(['metodo-wdc', 'scalix-ventas', 'analisis-llamadas-ventas'].includes(axis.source), `${room.id}/${axis.id}: fuente`);
      assert.equal(axis.source, 'metodo-wdc', `${room.id}/${axis.id}: la fuente por defecto es la academia`);
      assert.ok(axis.source_ref, `${room.id}/${axis.id}: sección de la skill`);
    }
  }
});

await step('el closer usa las fases y pesos de la skill (10/25/10/15/30/5/5)', () => {
  assert.deepEqual(weights('venta'), { apertura: 10, descubrimiento: 25, pitch: 10, control: 15, objecion: 30, siguiente: 5, etica: 5 });
  assert.equal(roomOf('venta'), 'venta');
  assert.equal(roomOf('venta', 'llamada'), 'llamada');
  // Setter, frío y entrevista se reasignan según rubrica.md §1 (no se recicla la rúbrica del closer).
  assert.deepEqual(weights('setter'), { apertura: 15, cualificacion: 30, agenda: 25, control: 15, traspaso: 10, etica: 5 });
  assert.deepEqual(weights('frio'), { apertura: 35, control: 15, siguiente: 30, objecion: 15, etica: 5 });
  assert.equal(DEFAULT_RUBRICS.entrevista.length, 4);
  assert.deepEqual(weights('entrevista'), { tres_p: 30, inteligencia: 25, etica_trabajo: 25, humildad: 20 });
  assert.deepEqual(weights('llamada'), { apertura: 10, descubrimiento: 25, pitch: 10, control: 15, objecion: 30, siguiente: 5, etica: 5 });
});

await step('el historial de cambios detalla pesos, guías, prioridades y BANT', () => {
  const before = { rubrics: clone(DEFAULT_RUBRICS), priorities: [...DEFAULT_PRIORITIES], bant: { ...DEFAULT_BANT } };
  assert.equal(diffPracticeConfig(before, clone(before)).total, 0, 'dos copias iguales no tienen cambios');
  const after = clone(before);
  after.rubrics.venta[1].weight = 30;
  after.rubrics.venta[1].guide = 'Guía nueva del descubrimiento.';
  after.rubrics.frio[0].enabled = false;
  after.priorities = [before.priorities[1], before.priorities[0], ...before.priorities.slice(2)];
  after.bant.entrevista = true;
  const diff = diffPracticeConfig(before, after);
  const peso = diff.axes.find(change => change.field === 'peso');
  assert.deepEqual([peso.room, peso.axis, peso.from, peso.to], ['venta', 'descubrimiento', '25', '30']);
  const guia = diff.axes.find(change => change.field === 'guía');
  assert.match(guia.from, /Primero la brecha con sus números/);
  assert.equal(guia.to, 'Guía nueva del descubrimiento.');
  const activo = diff.axes.find(change => change.field === 'activo');
  assert.deepEqual([activo.room, activo.from, activo.to], ['frio', 'activo', 'inactivo']);
  assert.equal(diff.prioritiesReordered, true);
  assert.deepEqual(diff.bant, [{ room: 'entrevista', enabled: true }]);
  assert.equal(diff.total, 5, 'tres ejes, un reorden y un BANT');
  // Comparar no modifica la rúbrica: la versión anterior queda como estaba (nada que recalcular).
  assert.equal(before.rubrics.venta[1].weight, 25);
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
  const badSource = clone(DEFAULT_RUBRICS); badSource.venta[0].source = 'opinion-propia';
  assert.equal(validateRubrics(badSource).ok, false);
  const noRef = clone(DEFAULT_RUBRICS); noRef.venta[0].source_ref = ' ';
  assert.equal(validateRubrics(noRef).ok, false);
  const tooFewActive = clone(DEFAULT_RUBRICS);
  tooFewActive.venta.forEach((axis, index) => { axis.enabled = index < 2; });
  assert.equal(validateRubrics(tooFewActive).ok, false);
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
  custom.venta[6].enabled = false;
  const axis = axesFor(closer, custom);
  assert.equal(axis.length, 6);
  assert.ok(!axis.some(item => item.id === 'etica'));
  assert.equal(axis[0].label, 'Apertura con prueba social');
  const instructions = debriefInstructions(closer, null, custom, ['Regla propia del panel.']);
  assert.match(instructions, /Abre con una prueba de un caso idéntico/);
  assert.match(instructions, /peso 13%/);
  assert.match(instructions, /1\. Regla propia del panel\./);
  const schema = debriefSchema(closer, custom);
  assert.ok(schema.properties.axes.items.properties.id.enum.includes('apertura'));
  assert.ok(!schema.properties.axes.items.properties.id.enum.includes('etica'));
  assert.ok(!debriefSchema(closer, custom).properties.axes.items.properties.id.enum.includes('marco'));
  // Desactivar no borra el criterio del panel, pero lo saca del prompt, del esquema y de la nota.
  assert.ok(custom.venta.some(item => item.id === 'etica' && item.enabled === false));
  const score = weightedScore(DEFAULT_RUBRICS.venta.map(item => ({ id: item.id, score: 100 })), custom.venta);
  assert.equal(score, 100);
});

await step('la cualificación solo se pide en las salas de venta y el prompt explica la vara', () => {
  assert.ok(needsBant(closer) && needsBant(setter) && needsBant(frio) && needsBant(CALL_REVIEW_SCENARIO));
  assert.equal(needsBant(interview), false);
  assert.ok(debriefSchema(closer).required.includes('bant'));
  assert.ok(!debriefSchema(interview).required.includes('bant'));
  assert.equal(debriefSchema(interview).properties.bant, undefined);
  assert.match(debriefInstructions(setter), /Auditoría de la cualificación/);
  assert.doesNotMatch(debriefInstructions(interview), /Auditoría de la cualificación/);
  assert.equal(DEFAULT_BANT.entrevista, false);
});

await step('la prioridad manda en el orden de la skill y el feedback no pide varias', () => {
  assert.match(DEFAULT_PRIORITIES[0], /No se cavó el dolor/i);
  const instructions = debriefInstructions(closer, null, DEFAULT_RUBRICS, DEFAULT_PRIORITIES);
  const first = instructions.indexOf('1. No se cavó el dolor');
  const later = instructions.indexOf('2. Se presentó la oferta antes de cualificar');
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

await step('la entrevista no exige BANT y puntúa los cuatro criterios de metodo-wdc §15', () => {
  const generic = scenarioById('entrevista-closer');
  const interviewPayload = JSON.parse(payload());
  delete interviewPayload.bant;
  interviewPayload.axes = DEFAULT_RUBRICS.entrevista.map(axis => ({ id: axis.id, score: 70, note: '', quote: '' }));
  const genericDebrief = cleanDebrief(JSON.stringify(interviewPayload), turns, generic);
  assert.ok(genericDebrief);
  assert.equal(genericDebrief.bant, undefined);
  assert.equal(genericDebrief.axes.length, 4);
  assert.equal(genericDebrief.score, 70);
  const profileDebrief = cleanDebrief(JSON.stringify(interviewPayload), turns, interview);
  assert.ok(profileDebrief);
  assert.equal(profileDebrief.axes.length, 4);
  assert.equal(profileDebrief.bant, undefined);
});

await step('una llamada real se evalúa con la rúbrica `llamada`, BANT y solo evidencia de la vendedora', () => {
  const parsed = parseCallTranscript('VENDEDOR: Hola, te llamo por el formulario. ¿Te importa que te haga una pregunta?\nCLIENTE: Dime, tengo cinco minutos.\nVENDEDOR: ¿Qué te hizo buscar una solución ahora?');
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.detail);
  assert.equal(parsed.turns[0].role, 'user');
  assert.equal(parsed.turns[1].role, 'coach');
  assert.equal(parsed.turns.length, 3);
  const review = JSON.parse(payload());
  review.axes = DEFAULT_RUBRICS.llamada.map((axis, index) => ({ id: axis.id, score: index === 0 ? 100 : 0, note: '', quote: '' }));
  const debrief = cleanDebrief(JSON.stringify(review), parsed.turns, CALL_REVIEW_SCENARIO);
  assert.ok(debrief);
  assert.equal(debrief.axes.length, 7);
  assert.equal(debrief.score, 10);
  assert.equal(debrief.scenario, CALL_REVIEW_SCENARIO.title);
  assert.equal(parsed.ok && parseCallTranscript('Sin etiquetas').ok, false);
  assert.equal(parseCallTranscript('VENDEDOR: Hola.').ok, false);
});

await step('el tipo de llamada se detecta y elige la rúbrica de cierre o de frío', () => {
  const cold = parseCallTranscript('VENDEDOR: Hola, ¿hablo con Marta? Soy Ana de WDC.\nCLIENTE: ¿Quién eres? No te conozco.\nVENDEDOR: Te llamo porque trabajáis con clínicas.');
  const warm = parseCallTranscript('VENDEDOR: Hola Marta, te llamo por el formulario que dejaste.\nCLIENTE: Sí, dime, tengo cinco minutos.\nVENDEDOR: ¿Qué te hizo buscar una solución ahora?');
  assert.ok(cold.ok && warm.ok);
  assert.equal(detectCallType(cold.turns).type, 'frio');
  assert.equal(detectCallType(warm.turns).type, 'closer');
  // Lo elegido a mano manda sobre la detección.
  assert.equal(resolveCallType('closer', cold.turns).type, 'closer');
  assert.equal(resolveCallType('auto', cold.turns).source, 'detectada');
  // Cada tipo se puntúa con su rúbrica: el cierre con la de evaluación de llamadas, el frío con la suya.
  assert.equal(callReviewScenario('closer').rubric, 'llamada');
  assert.equal(roomOf(callReviewScenario('closer').kind, callReviewScenario('closer').rubric), 'llamada');
  assert.equal(callReviewScenario('frio').rubric, undefined);
  assert.equal(roomOf(callReviewScenario('frio').kind, callReviewScenario('frio').rubric), 'frio');
  assert.equal(callReviewScenario('frio').review, true);
  // Cada eje puede traer el punto correcto y la mejora de ese paso, sin ser obligatorios.
  const review = JSON.parse(payload());
  review.axes = DEFAULT_RUBRICS.llamada.map((axis, index) => ({ id: axis.id, score: 50, note: '', quote: '', ...(index === 0 ? { right: 'Abrió pidiendo permiso.', improve: 'Nombró el motivo antes de preguntar.' } : {}) }));
  const debrief = cleanDebrief(JSON.stringify(review), warm.turns, callReviewScenario('closer'));
  assert.ok(debrief);
  assert.equal(debrief.axes[0].right, 'Abrió pidiendo permiso.');
  assert.equal(debrief.axes[0].improve, 'Nombró el motivo antes de preguntar.');
  assert.equal(debrief.axes[1].right, undefined);
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
  assert.equal(axesForRoom('llamada').length, 7);
});

for (const [status, name, detail] of results) console.log(status, ' ', name, detail ?? '');
const bad = results.filter(result => result[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
