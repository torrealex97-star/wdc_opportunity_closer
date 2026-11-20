// Criterios de la sala de práctica. Módulo PURO (sin Supabase ni red): lo importan el servidor
// (prompts y validación del feedback) y el panel de administración, que edita estos valores.
//
// Las rúbricas no son una invención del producto: se copian de las skills `scalix-ventas` y
// `analisis-llamadas-ventas` (instaladas en `.agents/skills/`), que a su vez se apoyan en el Ultimate
// Sales Blueprint. Pesos por tipo de llamada: rubrica.md §1. El feedback termina siempre en UNA
// corrección prioritaria (§Paso 4) porque «de 28 cosas mal en una llamada, solo una mueve el cierre».
export type PracticeRoom = 'venta' | 'setter' | 'frio' | 'entrevista' | 'llamada';
export type RubricSkill = 'scalix-ventas' | 'analisis-llamadas-ventas';
/** Cada criterio declara de qué skill y sección sale: el panel no puede inventar uno sin fuente. */
export type RubricAxis = {
  id: string;
  label: string;
  guide: string;
  weight: number;
  enabled: boolean;
  source: RubricSkill;
  source_ref: string;
};
export type RoomRubrics = Record<PracticeRoom, RubricAxis[]>;
export type BantConfig = Record<PracticeRoom, boolean>;
export type BantLetter = 'budget' | 'authority' | 'need' | 'timing';
export type BantStatus = '✓' | '~' | '✗' | '?';
export type PracticeDecision =
  | 'correcto_avanzar'
  | 'avanzar_sin_cualificar'
  | 'no_debio_avanzar'
  | 'correcto_parar'
  | 'paro_demasiado_pronto';
export type BantLetterResult = { status: BantStatus; quote: string };
/** Auditoría BANT de una llamada de venta: cuatro letras con evidencia y la decisión que tomó la vendedora. */
export type PracticeBant = Record<BantLetter, BantLetterResult> & { decision: PracticeDecision };

export const ROOMS: Array<{ id: PracticeRoom; label: string; note: string }> = [
  { id: 'venta', label: 'Closer · llamada de cierre', note: 'Rúbrica completa del Ultimate Sales Blueprint (rubrica.md §1-§8).' },
  { id: 'setter', label: 'Setter · cualificación y agenda', note: 'Peso en BANT, edificación del closer y cita con dos huecos.' },
  { id: 'frio', label: 'Llamada en frío', note: 'Peso en apertura y gancho, y en el paso a cita; el objetivo no es vender.' },
  { id: 'entrevista', label: 'Entrevista · contratación', note: 'Criterios de contratación de closers (scalix-ventas §7): las tres P, inteligencia, ética de trabajo y humildad.' },
  { id: 'llamada', label: 'Evaluación de llamadas', note: 'Puntúa la transcripción de una llamada real con la rúbrica de analisis-llamadas-ventas (fases, BANT y evidencia).' },
];

export const MIN_AXES = 3;
export const MAX_AXES = 8;
export const MAX_AXIS_WEIGHT = 100;
const AXIS_ID = /^[a-z][a-z0-9_]{1,29}$/;

// Pesos y criterios copiados de `analisis-llamadas-ventas/references/rubrica.md`.
// 0/1/2 por criterio se estima aquí en 0-100 para que la alumna vea una escala continua; el prompt
// traduce las bandas (0-40 ausente o dañino, 41-60 parcial, 61-80 correcto, 81-100 sólido).
type AxisSeed = Omit<RubricAxis, 'enabled' | 'source' | 'source_ref'>;
type RubricSeed = Record<PracticeRoom, AxisSeed[]>;

// Fuente y sección de cada criterio. Un id sin esta tabla no se puede guardar: así ningún criterio
// propio del producto se cuela como si viniera de las skills.
const TRACE: Record<string, Pick<RubricAxis, 'source' | 'source_ref'>> = {
  'venta:apertura': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §2 (A1-A2)' },
  'venta:descubrimiento': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §3 (B1-B5)' },
  'venta:pitch': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §4 (C1-C3)' },
  'venta:control': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §5 (D1-D5)' },
  'venta:objecion': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §6 (E1-E7)' },
  'venta:siguiente': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §7 (F1-F2)' },
  'venta:etica': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §8 (G1-G2)' },
  'setter:apertura': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §1 (setter) + §2 A1' },
  'setter:cualificacion': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §1 + §3 B5' },
  'setter:agenda': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §1 + §7 F1' },
  'setter:control': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §5 (D1-D5)' },
  'setter:traspaso': { source: 'scalix-ventas', source_ref: 'SKILL.md §5 (handoff y notas de seis líneas)' },
  'setter:etica': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §8 (G1-G2)' },
  'frio:apertura': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §1 (cold call) + §2 A1' },
  'frio:control': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §5 (D1-D5)' },
  'frio:siguiente': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §1 + §7 F1' },
  'frio:objecion': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §1 + §6 (E1-E7)' },
  'frio:etica': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §8 (G1-G2)' },
  'entrevista:tres_p': { source: 'scalix-ventas', source_ref: 'SKILL.md §7 (las tres P: prospecto, proceso, producto)' },
  'entrevista:inteligencia': { source: 'scalix-ventas', source_ref: 'SKILL.md §7 (inteligencia: velocidad de aprendizaje)' },
  'entrevista:etica_trabajo': { source: 'scalix-ventas', source_ref: 'SKILL.md §7 (ética de trabajo)' },
  'entrevista:humildad': { source: 'scalix-ventas', source_ref: 'SKILL.md §7 (humildad)' },
  'llamada:apertura': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §2 (A1-A2)' },
  'llamada:descubrimiento': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §3 (B1-B5)' },
  'llamada:pitch': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §4 (C1-C3)' },
  'llamada:control': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §5 (D1-D5)' },
  'llamada:objecion': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §6 (E1-E7)' },
  'llamada:siguiente': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §7 (F1-F2)' },
  'llamada:etica': { source: 'analisis-llamadas-ventas', source_ref: 'references/rubrica.md §8 (G1-G2)' },
};

const BASE_RUBRICS: RubricSeed = {
  venta: [
    {
      id: 'apertura', label: 'Apertura y agenda', weight: 10,
      guide: 'En 15-20 segundos: por qué está en la llamada, una prueba breve de casos como el suyo y el plan (dónde está, dónde quiere estar y si encaja). Usa las notas previas y no le hace repetir lo que ya contó.',
    },
    {
      id: 'descubrimiento', label: 'Clarify, label y pain cycle', weight: 25,
      guide: 'Aclara qué le hizo pedir la llamada, resume el hueco (dónde está, dónde quiere llegar y qué le frena) y lo confirma. Saca historial y cuantifica el coste en tiempo, dinero y estatus. Recoge BANT aquí, antes de hablar de dinero.',
    },
    {
      id: 'pitch', label: 'Pitch en dos minutos', weight: 10,
      guide: 'Tres pilares conectados con lo que falló antes, una metáfora o analogía y foco en el resultado, no en las características. Solo presenta lo que mapea con lo que él dijo.',
    },
    {
      id: 'control', label: 'Control con preguntas', weight: 15,
      guide: 'El prospecto habla alrededor de dos tercios. Ante una pregunta de detalle, devuelve otra pregunta antes de responder a ciegas. No entra en tecnicismos ni discute.',
    },
    {
      id: 'objecion', label: 'Objeciones y cierre', weight: 30,
      guide: 'Aísla la objeción antes de responderla, valida con «y» (nunca «pero») y usa AAA entre cierres. Pide la venta, sostiene el silencio tras el precio y vuelve a pedir tras el primer no, sin bajar el precio ni inventar urgencia.',
    },
    {
      id: 'siguiente', label: 'Handshake y siguiente paso', weight: 5,
      guide: 'Si no compra, agenda la siguiente conversación dentro de la llamada (BAMFAM) con día y hora. «Te mando información» o «ya te escribo» no es un siguiente paso.',
    },
    {
      id: 'etica', label: 'Rapport y ética', weight: 5,
      guide: 'Decide pensando en el cliente, con curiosidad y sin «commission breath». No inventa escasez ni resultados y descalifica con claridad a quien no encaja.',
    },
  ],
  setter: [
    {
      id: 'apertura', label: 'Primer mensaje', weight: 15,
      guide: 'Responde en minutos (speed to lead) con nombre, contexto de dónde viene el lead y una pregunta. Nada de párrafos ni audios largos.',
    },
    {
      id: 'cualificacion', label: 'BANT y cualificación', weight: 30,
      guide: 'Saca presupuesto, autoridad, necesidad y momento con preguntas cortas, una cada vez, sin que parezca un interrogatorio. Necesidad = objetivo concreto + obstáculo real; momento = quiere resolverlo ya.',
    },
    {
      id: 'agenda', label: 'Edificación y agenda', weight: 25,
      guide: 'Edifica al closer y vende el VSL como ahorro de tiempo. Ofrece dos huecos de las próximas 24-48 horas con día y hora y deja la cita confirmada, no «pendiente».',
    },
    {
      id: 'control', label: 'Control de la conversación', weight: 15,
      guide: 'Lleva el hilo con preguntas, no con discursos. Convierte respuestas vacías en información y no deja que el lead marque el ritmo.',
    },
    {
      id: 'traspaso', label: 'Traspaso al closer', weight: 10,
      guide: 'Deja una nota limpia de seis líneas para el CRM: quién es, qué quiere, qué le frena, BANT, objeciones esperadas y siguiente paso. El closer no debe hacerle repetir todo.',
    },
    {
      id: 'etica', label: 'Rapport y ética', weight: 5,
      guide: 'Trato cercano y honesto: sin urgencia falsa, sin culpar al lead y sin agendar a quien no puede beneficiarse.',
    },
  ],
  frio: [
    {
      id: 'apertura', label: 'Apertura y gancho', weight: 35,
      guide: 'En 15-30 segundos: nombre, empresa, motivo concreto y permiso para una pregunta. Sin disculparse, sin vender antes de descubrir y sin un discurso que se pueda contestar con «mándame un correo».',
    },
    {
      id: 'control', label: 'Control con preguntas', weight: 15,
      guide: 'Una pregunta cada vez y silencio para dejar hablar. Ante «estoy ocupado» o una pregunta de detalle, no responde a ciegas: reencuadra y vuelve a preguntar.',
    },
    {
      id: 'siguiente', label: 'Paso a cita con dos opciones', weight: 30,
      guide: 'Cualifica urgencia, autoridad y recursos en la misma llamada y propone dos huecos con día y hora. Descalificar con claridad también es un resultado válido.',
    },
    {
      id: 'objecion', label: 'Manejo del primer no', weight: 15,
      guide: 'El «no me interesa» o «mándame un correo» se trabaja sin discutir: valida, da un motivo nuevo y vuelve a pedir la cita. No insiste con el mismo argumento.',
    },
    {
      id: 'etica', label: 'Rapport y ética', weight: 5,
      guide: 'Trata bien a quien filtra, no inventa urgencias ni se salta a recepción con engaños. Cierra el contacto con claridad cuando no encaja.',
    },
  ],
  entrevista: [
    {
      id: 'tres_p', label: 'Las tres P', weight: 30,
      guide: 'Demuestra al menos dos de las tres P (prospecto, proceso, producto) y, si es posible, haber vendido al mismo tipo de prospecto. Da un caso verificable, no una promesa.',
    },
    {
      id: 'inteligencia', label: 'Velocidad de aprendizaje', weight: 25,
      guide: 'Aprende con el coaching en tiempo real: incorpora una corrección en la misma conversación y mejora la siguiente respuesta. No repite el error después de señalado.',
    },
    {
      id: 'etica_trabajo', label: 'Ética de trabajo', weight: 25,
      guide: 'Llega preparada, conoce el script y el producto, hace preguntas de calidad y explica cómo hace seguimiento. La preparación se nota en lo que pregunta, no en lo que promete.',
    },
    {
      id: 'humildad', label: 'Humildad', weight: 20,
      guide: 'Acepta el feedback sin defenderse, reconoce lo que no sabe o no midió y asume su parte en los resultados. No culpa al lead, al mercado ni a otros equipos.',
    },
  ],
  llamada: [
    {
      id: 'apertura', label: 'Apertura y agenda', weight: 10,
      guide: 'La transcripción muestra agenda en 15-20 segundos con prueba, promesa y plan, y uso de las notas previas sin hacer repetir al prospecto. Si el transcript no cubre la apertura, marca NE y excluye el peso.',
    },
    {
      id: 'descubrimiento', label: 'Clarify, label y pain cycle', weight: 25,
      guide: 'Aclaró por qué estaba ahí, resumió el hueco y obtuvo confirmación; sacó historial y cuantificó el coste antes de presentar. Si no hubo descubrimiento, la skill indica no puntuar la llamada.',
    },
    {
      id: 'pitch', label: 'Pitch', weight: 10,
      guide: 'Presentó como máximo tres pilares conectados con lo que falló antes, con una metáfora o analogía y foco en el resultado, no en características.',
    },
    {
      id: 'control', label: 'Control con preguntas', weight: 15,
      guide: 'El prospecto habló alrededor de dos tercios, devolvió pregunta ante detalles y no discutió. La ratio de habla se estima solo si la transcripción permite contar palabras o turnos.',
    },
    {
      id: 'objecion', label: 'Objeciones y cierre', weight: 30,
      guide: 'Aisló la objeción antes de rebatir, usó AAA, pidió la venta, volvió a pedir tras el primer no y no bajó el precio. Distingue ejecución de resultado.',
    },
    {
      id: 'siguiente', label: 'Handshake y siguiente paso', weight: 5,
      guide: 'Si no compró, dejó BAMFAM con día y hora; si compró, hizo el handshake con la persona siguiente y el contexto. «Te mando información» no es un siguiente paso.',
    },
    {
      id: 'etica', label: 'Rapport y ética', weight: 5,
      guide: 'Puso al prospecto en el centro, no inventó escasez ni resultados y descalificó con claridad a quien no encajaba. Una mala práctica grave se reporta aparte.',
    },
  ],
};

const traceOf = (room: PracticeRoom, id: string) => TRACE[`${room}:${id}`];

// Los valores por defecto se enriquecen con la fuente y quedan activos. El panel puede desactivar un
// criterio, pero no crear uno nuevo sin fuente: cada uno sigue siendo rastreable a una skill.
export const DEFAULT_RUBRICS: RoomRubrics = Object.fromEntries(ROOMS.map(room => [room.id, BASE_RUBRICS[room.id].map(axis => ({
  ...axis,
  enabled: true,
  ...(traceOf(room.id, axis.id) ?? { source: 'analisis-llamadas-ventas' as const, source_ref: 'references/rubrica.md' }),
}))])) as RoomRubrics;

// Orden de impacto de `analisis-llamadas-ventas` §Paso 4.3. El feedback elige UNA y no recorre la lista.
export const DEFAULT_PRIORITIES: string[] = [
  'No hubo pain cycle ni se cuantificó el coste de no actuar.',
  'BANT, decisor o momento aparecieron después de pedir el dinero.',
  'Se cayó en detalles: respondió preguntas a ciegas sin devolver pregunta.',
  'No pidió la venta o no volvió a pedir tras el primer no.',
  'Habló más que el prospecto o hizo un pitch largo sobre el producto.',
  'No hubo agenda de apertura (prueba, promesa y plan).',
  'Siguió vendiendo después del sí o negoció el precio.',
  'Entrega: tono, ritmo, énfasis y convicción.',
];

// Entrevista: la skill de análisis de llamadas no puntúa entrevistas (no hay discovery de venta).
// No se pide BANT en una entrevista; pedirlo convertiría una conversación de selección en un interrogatorio.
export const DEFAULT_BANT: BantConfig = { venta: true, setter: true, frio: true, entrevista: false, llamada: true };

export const BANT_LABELS: Record<BantLetter, string> = {
  budget: 'Presupuesto',
  authority: 'Autoridad',
  need: 'Necesidad',
  timing: 'Momento',
};
export const BANT_HELP: Record<BantLetter, string> = {
  budget: 'Puede pagar el precio. Si está justo: ¿es el problema más importante y compensa invertir?',
  authority: 'Todos los decisores están en esta llamada o en la siguiente.',
  need: 'Objetivo concreto + obstáculo real que se lo impide. El deseo sin obstáculo no es necesidad.',
  timing: 'Quiere resolverlo ya, no «algún día». Agendar la siguiente llamada no es timing.',
};
export const BANT_STATUS_LABELS: Record<BantStatus, string> = {
  '✓': 'fuerte',
  '~': 'débil',
  '✗': 'falla',
  '?': 'nunca salió',
};

export const DECISION_LABELS: Record<PracticeDecision, string> = {
  correcto_avanzar: 'Correcto avanzar',
  avanzar_sin_cualificar: 'Avanzó sin cualificar bien',
  no_debio_avanzar: 'No debió avanzar',
  correcto_parar: 'Correcto parar',
  paro_demasiado_pronto: 'Paró demasiado pronto',
};

export const PRACTICE_DECISIONS = Object.keys(DECISION_LABELS) as PracticeDecision[];
export const BANT_STATUSES: BantStatus[] = ['✓', '~', '✗', '?'];

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export const roomOf = (kind: Exclude<PracticeRoom, 'llamada'>, rubric?: PracticeRoom): PracticeRoom =>
  rubric ?? kind;

/** Valida una rúbrica completa. Devuelve el valor normalizado o el motivo exacto, sin arreglarla a medias. */
export function validateRubrics(value: unknown): { ok: true; value: RoomRubrics } | { ok: false; detail: string } {
  if (!isRecord(value)) return { ok: false, detail: 'Las rúbricas deben ser un objeto con las cinco salas.' };
  const out = {} as RoomRubrics;
  for (const room of ROOMS) {
    const list = value[room.id];
    if (!Array.isArray(list) || list.length < MIN_AXES || list.length > MAX_AXES) {
      return { ok: false, detail: `${room.label}: debe tener entre ${MIN_AXES} y ${MAX_AXES} criterios.` };
    }
    const ids = new Set<string>();
    const axes: RubricAxis[] = [];
    for (const item of list) {
      if (!isRecord(item)) return { ok: false, detail: `${room.label}: un criterio no es un objeto.` };
      const id = text(item.id, 30);
      const label = text(item.label, 60);
      const guide = text(item.guide, 400);
      const weight = typeof item.weight === 'number' ? Math.round(item.weight) : NaN;
      const enabled = item.enabled === undefined ? true : item.enabled;
      if (!AXIS_ID.test(id)) return { ok: false, detail: `${room.label}: el id «${id || '(vacío)'}» no es válido (minúsculas, números y guion bajo).` };
      if (ids.has(id)) return { ok: false, detail: `${room.label}: el criterio «${id}» está repetido.` };
      if (!label) return { ok: false, detail: `${room.label}: el criterio «${id}» no tiene nombre.` };
      if (!guide) return { ok: false, detail: `${room.label}: el criterio «${label}» no tiene guía.` };
      if (typeof enabled !== 'boolean') return { ok: false, detail: `${room.label}: «${label}» debe indicar si está activo.` };
      if (!Number.isFinite(weight) || weight < 1 || weight > MAX_AXIS_WEIGHT) {
        return { ok: false, detail: `${room.label}: el peso de «${label}» debe estar entre 1 y ${MAX_AXIS_WEIGHT}.` };
      }
      const fallback = traceOf(room.id, id);
      const source = item.source === undefined ? fallback?.source : item.source;
      const sourceRef = item.source_ref === undefined ? fallback?.source_ref : text(item.source_ref, 160);
      if (source !== 'scalix-ventas' && source !== 'analisis-llamadas-ventas') {
        return { ok: false, detail: `${room.label}: «${label}» no declara una fuente de las skills.` };
      }
      if (!sourceRef) return { ok: false, detail: `${room.label}: «${label}» no declara la sección de la skill de la que sale.` };
      ids.add(id);
      axes.push({ id, label, guide, weight, enabled, source, source_ref: sourceRef });
    }
    const enabledAxes = axes.filter(axis => axis.enabled);
    if (enabledAxes.length < MIN_AXES) return { ok: false, detail: `${room.label}: debe tener al menos ${MIN_AXES} criterios activos (tiene ${enabledAxes.length}).` };
    const total = enabledAxes.reduce((sum, axis) => sum + axis.weight, 0);
    if (total < MIN_AXES) return { ok: false, detail: `${room.label}: la suma de pesos activos es demasiado baja (${total}).` };
    out[room.id] = axes;
  }
  return { ok: true, value: out };
}

export function validatePriorities(value: unknown): { ok: true; value: string[] } | { ok: false; detail: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return { ok: false, detail: 'Debe haber entre 1 y 8 prioridades de corrección.' };
  const list = value.map(item => text(item, 200));
  if (list.some(item => !item)) return { ok: false, detail: 'Ninguna prioridad puede quedar vacía.' };
  if (new Set(list).size !== list.length) return { ok: false, detail: 'Hay prioridades repetidas.' };
  return { ok: true, value: list };
}

export function validateBant(value: unknown): { ok: true; value: BantConfig } | { ok: false; detail: string } {
  if (!isRecord(value)) return { ok: false, detail: 'La configuración de BANT debe ser un objeto por sala.' };
  const out = {} as BantConfig;
  for (const room of ROOMS) {
    const flag = value[room.id];
    if (typeof flag !== 'boolean') return { ok: false, detail: `${room.label}: BANT debe ser sí o no.` };
    out[room.id] = flag;
  }
  return { ok: true, value: out };
}

export const axesForRoom = (room: PracticeRoom, rubrics: RoomRubrics = DEFAULT_RUBRICS): RubricAxis[] => rubrics[room].filter(axis => axis.enabled);

/** Media ponderada por los pesos de la rúbrica; se normaliza, así los pesos no tienen que sumar 100. */
export function weightedScore(axes: Array<{ id: string; score: number }>, rubric: RubricAxis[]): number {
  const weights = new Map(rubric.filter(axis => axis.enabled !== false).map(axis => [axis.id, axis.weight]));
  let sum = 0;
  let total = 0;
  for (const axis of axes) {
    const weight = weights.get(axis.id);
    if (!weight) continue;
    sum += axis.score * weight;
    total += weight;
  }
  return total ? Math.round(sum / total) : 0;
}

/** Etiquetas de eje por id, para «Mi progreso» sin duplicar textos entre rúbricas. */
export function allAxisLabels(rubrics: RoomRubrics = DEFAULT_RUBRICS): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const room of ROOMS) for (const axis of rubrics[room.id]) if (!labels[axis.id]) labels[axis.id] = axis.label;
  return labels;
}

/** La parte comparable de una configuración (la que guarda cada versión del historial). */
export type PracticeConfigShape = { rubrics: RoomRubrics; priorities: string[]; bant: BantConfig };
export type AxisField = 'peso' | 'guía' | 'nombre' | 'activo' | 'fuente';
export type AxisChange = { room: PracticeRoom; axis: string; axisLabel: string; field: AxisField; from: string; to: string };
export type PracticeConfigDiff = {
  axes: AxisChange[];
  added: Array<{ room: PracticeRoom; axisLabel: string }>;
  removed: Array<{ room: PracticeRoom; axisLabel: string }>;
  prioritiesAdded: string[];
  prioritiesRemoved: string[];
  prioritiesReordered: boolean;
  bant: Array<{ room: PracticeRoom; enabled: boolean }>;
  total: number;
};

/** Qué cambió entre dos versiones: pesos, guías, nombres, activación, fuente, prioridades y BANT.
 *  El historial guarda la rúbrica completa de cada versión, así que el detalle se calcula al leer y no
 *  hay que almacenarlo aparte ni recalcular ninguna práctica ya puntuada. */
export function diffPracticeConfig(prev: PracticeConfigShape, next: PracticeConfigShape): PracticeConfigDiff {
  const axes: AxisChange[] = [];
  const added: PracticeConfigDiff['added'] = [];
  const removed: PracticeConfigDiff['removed'] = [];
  for (const roomInfo of ROOMS) {
    const room = roomInfo.id;
    const before = new Map((prev.rubrics[room] ?? []).map(axis => [axis.id, axis] as const));
    const after = new Map((next.rubrics[room] ?? []).map(axis => [axis.id, axis] as const));
    for (const [id, axis] of after) {
      const old = before.get(id);
      if (!old) { added.push({ room, axisLabel: axis.label }); continue; }
      const push = (field: AxisField, from: string, to: string) => axes.push({ room, axis: id, axisLabel: axis.label, field, from, to });
      if (old.weight !== axis.weight) push('peso', String(old.weight), String(axis.weight));
      if (old.guide !== axis.guide) push('guía', old.guide, axis.guide);
      if (old.label !== axis.label) push('nombre', old.label, axis.label);
      if (old.enabled !== axis.enabled) push('activo', old.enabled ? 'activo' : 'inactivo', axis.enabled ? 'activo' : 'inactivo');
      if (old.source !== axis.source || old.source_ref !== axis.source_ref) {
        push('fuente', `${old.source} · ${old.source_ref}`, `${axis.source} · ${axis.source_ref}`);
      }
    }
    for (const [id, axis] of before) if (!after.has(id)) removed.push({ room, axisLabel: axis.label });
  }
  const prioritiesAdded = next.priorities.filter(item => !prev.priorities.includes(item));
  const prioritiesRemoved = prev.priorities.filter(item => !next.priorities.includes(item));
  const prioritiesReordered = !prioritiesAdded.length && !prioritiesRemoved.length
    && prev.priorities.join('\u0000') !== next.priorities.join('\u0000');
  const bant = ROOMS
    .filter(item => prev.bant[item.id] !== next.bant[item.id])
    .map(item => ({ room: item.id, enabled: next.bant[item.id] }));
  const total = axes.length + added.length + removed.length + prioritiesAdded.length
    + prioritiesRemoved.length + (prioritiesReordered ? 1 : 0) + bant.length;
  return { axes, added, removed, prioritiesAdded, prioritiesRemoved, prioritiesReordered, bant, total };
}
