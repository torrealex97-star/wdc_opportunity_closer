// Criterios de la sala de práctica. Módulo PURO (sin Supabase ni red): lo importan el servidor
// (prompts y validación del feedback) y el panel de administración, que edita estos valores.
//
// Las rúbricas no son una invención del producto: dicen lo que enseña la academia y salen de la skill
// `metodo-wdc` (`.agents/skills/metodo-wdc/SKILL.md`), que es el método de Women Digital Closers leído
// de su propia formación. Las otras dos skills se quedan como fuente secundaria para no romper las
// configuraciones ya guardadas. El feedback termina siempre en UNA corrección prioritaria porque «de
// 28 cosas mal en una llamada, solo una mueve el cierre».
export type PracticeRoom = 'venta' | 'setter' | 'frio' | 'entrevista' | 'llamada';
export type RubricSkill = 'metodo-wdc' | 'scalix-ventas' | 'analisis-llamadas-ventas';
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
/**
 * Auditoría de la cualificación de una llamada de venta: dinero, decisión, necesidad y momento, con
 * evidencia y la decisión que tomó la vendedora. La clave `bant` y las de las cuatro preguntas se
 * conservan tal cual: son el contrato guardado de las configuraciones y de los feedbacks ya emitidos.
 */
export type PracticeBant = Record<BantLetter, BantLetterResult> & { decision: PracticeDecision };

export const ROOMS: Array<{ id: PracticeRoom; label: string; note: string }> = [
  { id: 'venta', label: 'Closer · llamada de cierre', note: 'La rúbrica completa de la llamada de cierre de la academia: apertura y marco, brecha, oferta, objeciones y siguiente paso (metodo-wdc §8–§13).' },
  { id: 'setter', label: 'Setter · cualificación y agenda', note: 'Peso en la cualificación (tiempo, dinero y confianza), el marco del closer y la cita con dos huecos.' },
  { id: 'frio', label: 'Llamada en frío', note: 'Peso en apertura y gancho, y en el paso a cita; el objetivo no es vender.' },
  { id: 'entrevista', label: 'Entrevista · contratación', note: 'Criterios de contratación de closers (metodo-wdc §15): las tres P, inteligencia, ética de trabajo y humildad.' },
  { id: 'llamada', label: 'Evaluación de llamadas', note: 'Puntúa la transcripción de una llamada real con la rúbrica de analisis-llamadas-ventas (fases, cualificación y evidencia).' },
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
  'venta:apertura': { source: 'metodo-wdc', source_ref: 'SKILL.md §8 (6.1 · apertura y marco)' },
  'venta:descubrimiento': { source: 'metodo-wdc', source_ref: 'SKILL.md §9 y §1.4 (6.3 · cualificación y dolor)' },
  'venta:pitch': { source: 'metodo-wdc', source_ref: 'SKILL.md §10 (6.4 · presentación de la oferta)' },
  'venta:control': { source: 'metodo-wdc', source_ref: 'SKILL.md §4 (autoridad, silencio y escucha)' },
  'venta:objecion': { source: 'metodo-wdc', source_ref: 'SKILL.md §11 y §12 (6.5 · cierre, 7.x · objeciones)' },
  'venta:siguiente': { source: 'metodo-wdc', source_ref: 'SKILL.md §13 (8.3 · fases del seguimiento)' },
  'venta:etica': { source: 'metodo-wdc', source_ref: 'SKILL.md §2 y §18 (código ético y límites)' },
  'setter:apertura': { source: 'metodo-wdc', source_ref: 'SKILL.md §15 (11.3 · mensajes de captación)' },
  'setter:cualificacion': { source: 'metodo-wdc', source_ref: 'SKILL.md §9 y §12.2 (tiempo, dinero y confianza)' },
  'setter:agenda': { source: 'metodo-wdc', source_ref: 'SKILL.md §15 y §13 (11.3 · captación y fases)' },
  'setter:control': { source: 'metodo-wdc', source_ref: 'SKILL.md §4 (escuchar, nombrar y devolver)' },
  'setter:traspaso': { source: 'metodo-wdc', source_ref: 'SKILL.md §13 (8.3 · confirmación y traspaso)' },
  'setter:etica': { source: 'metodo-wdc', source_ref: 'SKILL.md §2 (código ético)' },
  'frio:apertura': { source: 'metodo-wdc', source_ref: 'SKILL.md §8 (6.1 · apertura y marco)' },
  'frio:control': { source: 'metodo-wdc', source_ref: 'SKILL.md §4 (autoridad y silencio)' },
  'frio:siguiente': { source: 'metodo-wdc', source_ref: 'SKILL.md §8 y §15 (siguiente paso con día y hora)' },
  'frio:objecion': { source: 'metodo-wdc', source_ref: 'SKILL.md §12 (objeciones)' },
  'frio:etica': { source: 'metodo-wdc', source_ref: 'SKILL.md §2 (código ético)' },
  'entrevista:tres_p': { source: 'metodo-wdc', source_ref: 'SKILL.md §15 (11.7 y currículum: evidencia, no promesas)' },
  'entrevista:inteligencia': { source: 'metodo-wdc', source_ref: 'SKILL.md §15 (lo que mira quien contrata)' },
  'entrevista:etica_trabajo': { source: 'metodo-wdc', source_ref: 'SKILL.md §15 (preparación y preguntas propias)' },
  'entrevista:humildad': { source: 'metodo-wdc', source_ref: 'SKILL.md §15 (humildad y qué harías distinto)' },
  'llamada:apertura': { source: 'metodo-wdc', source_ref: 'SKILL.md §8 (6.1 · apertura y marco)' },
  'llamada:descubrimiento': { source: 'metodo-wdc', source_ref: 'SKILL.md §9 y §1.4 (6.3 · cualificación)' },
  'llamada:pitch': { source: 'metodo-wdc', source_ref: 'SKILL.md §10 (6.4 · presentación)' },
  'llamada:control': { source: 'metodo-wdc', source_ref: 'SKILL.md §4 (autoridad y escucha)' },
  'llamada:objecion': { source: 'metodo-wdc', source_ref: 'SKILL.md §11 y §12 (cierres y objeciones)' },
  'llamada:siguiente': { source: 'metodo-wdc', source_ref: 'SKILL.md §13 (8.3 · fases del seguimiento)' },
  'llamada:etica': { source: 'metodo-wdc', source_ref: 'SKILL.md §2 y §18 (código ético y límites)' },
};

const BASE_RUBRICS: RubricSeed = {
  venta: [
    {
      id: 'apertura', label: 'Apertura y marco', weight: 10,
      guide: 'En 15-20 segundos: por qué está en la llamada, una prueba breve de su caso y el plan (dónde está, dónde quiere estar y si encaja). Usa las notas previas, no le hace repetir lo que ya contó y no improvisa ni se salta fases (6.1).',
    },
    {
      id: 'descubrimiento', label: 'Descubrimiento y dolor', weight: 25,
      guide: 'Primero la brecha con sus números, después el dolor cavado («¿por qué?», «cuéntame más», «dame un ejemplo»), el historial y el resumen con su etiqueta confirmado. Cualifica tiempo, dinero y confianza antes de hablar de precio (6.3, 7.1).',
    },
    {
      id: 'pitch', label: 'Presentación de la oferta', weight: 10,
      guide: 'Resultado primero y después el cómo: tres o cuatro pilares conectados con lo que le falló antes, una analogía y foco en el resultado. Solo presenta lo que mapea con lo que ella dijo, en 3-5 minutos y sin justificar (6.4).',
    },
    {
      id: 'control', label: 'Control con preguntas', weight: 15,
      guide: 'La clienta habla más que tú. Ante una pregunta de detalle, devuelve la pregunta antes de responder a ciegas; nombra lo que cuenta, devuelve su última frase y sostiene el silencio cuando el tono cambia (2.6, 9.7-9.9).',
    },
    {
      id: 'objecion', label: 'Objeciones y cierre', weight: 30,
      guide: 'Micro cierres y resumen estratégico antes del precio. Cuando aparece la objeción: nombrarla, profundizarla y cerrar sobre ese obstáculo, un cierre por obstáculo con la frase de 6.5. Pide la decisión, sostiene el silencio y no baja el precio (6.5, 7.3, 7.9).',
    },
    {
      id: 'siguiente', label: 'Siguiente paso y ciclo cerrado', weight: 5,
      guide: 'Toda decisión termina en sí, no o ahora no, con día y hora para la siguiente conversación (fases de 8.3). «Te mando información» o «ya te escribo» no es un siguiente paso.',
    },
    {
      id: 'etica', label: 'Diagnóstico y ética', weight: 5,
      guide: 'Diagnostica antes de ofrecer y dice que no cuando no encaja. No inventa escasez ni promete resultados: las garantías del material están marcadas como no copiables.',
    },
  ],
  setter: [
    {
      id: 'apertura', label: 'Primer mensaje', weight: 15,
      guide: 'Responde en minutos con nombre, de dónde viene y una pregunta sobre su caso. El primer mensaje abre la conversación, no la cierra: ni párrafos ni audios largos (11.3).',
    },
    {
      id: 'cualificacion', label: 'Cualificación', weight: 30,
      guide: 'Tiempo, dinero y confianza, una pregunta cada vez, más la prioridad del 1 al 10. Con 6 o menos no se agenda para cerrar: se cualifica mejor o no encaja (7.1, 7.3).',
    },
    {
      id: 'agenda', label: 'Cita con día y hora', weight: 25,
      guide: 'Dos huecos de las próximas 24-48 horas, con día y hora, y la cita confirmada —no «pendiente»—. Vende la llamada por lo que se lleva de ella, no por lo que dura (11.3, 8.3).',
    },
    {
      id: 'control', label: 'Control de la conversación', weight: 15,
      guide: 'Lleva el hilo con preguntas, no con discursos. Devuelve la pregunta cuando piden un detalle y convierte respuestas vacías en información sin dejar que el lead marque el ritmo (2.6).',
    },
    {
      id: 'traspaso', label: 'Traspaso a la closer', weight: 10,
      guide: 'Deja la nota antes de la llamada: quién es, qué quiere, qué le frena, qué ha intentado, objeciones esperadas y siguiente paso. La closer no debe hacerle repetir todo (8.3).',
    },
    {
      id: 'etica', label: 'Trato y ética', weight: 5,
      guide: 'Cercana y honesta: sin urgencia falsa, sin culpar al lead y sin agendar a quien no puede beneficiarse (código ético, 2.2).',
    },
  ],
  frio: [
    {
      id: 'apertura', label: 'Apertura y gancho', weight: 35,
      guide: 'En 15-30 segundos: nombre, motivo concreto y permiso para una pregunta. Sin disculparse y sin vender antes de descubrir; si se puede contestar con «mándame un correo», está mal abierta (6.1).',
    },
    {
      id: 'control', label: 'Control con preguntas', weight: 15,
      guide: 'Una pregunta cada vez y silencio para dejar hablar. Ante «estoy ocupado» o un detalle, no respondas a ciegas: reencuadra y vuelve a preguntar (2.6).',
    },
    {
      id: 'siguiente', label: 'Paso a cita con dos opciones', weight: 30,
      guide: 'Cualifica tiempo, dinero y confianza en la misma llamada y propone dos huecos con día y hora. Decir con claridad que no encaja también es un resultado válido (2.2, 11.3).',
    },
    {
      id: 'objecion', label: 'Manejo del primer no', weight: 15,
      guide: 'El «no me interesa» o «mándame un correo» se trabaja sin discutir: validar, dar un motivo nuevo y volver a pedir la cita, sin repetir el mismo argumento (7.1, 7.9).',
    },
    {
      id: 'etica', label: 'Trato y ética', weight: 5,
      guide: 'Trato limpio a quien filtra, sin urgencias inventadas ni saltarse a recepción con engaños. Cierra el contacto con claridad cuando no encaja (2.2).',
    },
  ],
  entrevista: [
    {
      id: 'tres_p', label: 'Criterio y evidencia', weight: 30,
      guide: 'Cuenta con un caso verificable qué vendía, a quién y qué resultado dio, y cómo lo medirías si no tienes la cifra. Nada de cifras redondas que se desmontan con una repregunta (11.7, 11.8).',
    },
    {
      id: 'inteligencia', label: 'Aprender de la corrección', weight: 25,
      guide: 'Acepta una corrección en la propia entrevista e incorpora el cambio en la respuesta siguiente. Eso es lo que mira quien contrata: cómo aprendes, no lo que prometes (11.8).',
    },
    {
      id: 'etica_trabajo', label: 'Preparación', weight: 25,
      guide: 'Llega con dos preguntas propias sobre cómo se mide el éxito y de dónde vienen los leads. La preparación se nota en lo que pregunta, no en lo que dice de sí misma (11.7).',
    },
    {
      id: 'humildad', label: 'Humildad', weight: 20,
      guide: 'Reconoce lo que no sabe o no midió, asume su parte en los resultados y no culpa al lead, al mercado ni al equipo. Termina con qué haría distinto (11.8).',
    },
  ],
  llamada: [
    {
      id: 'apertura', label: 'Apertura y marco', weight: 10,
      guide: 'La transcripción muestra el marco de 6.1: agenda en 15-20 segundos con prueba, promesa y plan, y uso de las notas previas sin hacer repetir a la clienta. Si el transcript no cubre la apertura, marca NE y excluye el peso.',
    },
    {
      id: 'descubrimiento', label: 'Descubrimiento y dolor', weight: 25,
      guide: 'Brecha con números, dolor cavado con «¿por qué?» y ejemplos, historial y resumen confirmado, todo antes de presentar. Si no hubo descubrimiento, no se puntúa la llamada: se corrige el orden (6.3).',
    },
    {
      id: 'pitch', label: 'Presentación de la oferta', weight: 10,
      guide: 'Presentó como máximo cuatro pilares conectados con lo que le falló antes, con una analogía y foco en el resultado, no en características (6.4).',
    },
    {
      id: 'control', label: 'Control con preguntas', weight: 15,
      guide: 'La clienta habló más, devolvió pregunta ante los detalles y nombró el dolor con sus palabras. La ratio de habla se estima solo si la transcripción permite contar turnos (2.6).',
    },
    {
      id: 'objecion', label: 'Objeciones y cierre', weight: 30,
      guide: 'Nombró la objeción antes de responder, la profundizó, cerró sobre ese obstáculo, pidió la decisión y sostuvo el silencio. No bajó el precio ni prometió resultados. Distingue ejecución de resultado (6.5, 7.2, 7.9).',
    },
    {
      id: 'siguiente', label: 'Siguiente paso', weight: 5,
      guide: 'Si no compró, dejó día y hora para la siguiente conversación y cerró el ciclo en sí, no o ahora no. Si compró, explicó qué pasa ahora y quién hace qué (8.3).',
    },
    {
      id: 'etica', label: 'Diagnóstico y ética', weight: 5,
      guide: 'Puso a la clienta en el centro, no inventó escasez ni resultados y dijo que no encajaba cuando era el caso. Una mala práctica grave se reporta aparte (2.2, 18).',
    },
  ],
};

const traceOf = (room: PracticeRoom, id: string) => TRACE[`${room}:${id}`];

// Los valores por defecto se enriquecen con la fuente y quedan activos. El panel puede desactivar un
// criterio, pero no crear uno nuevo sin fuente: cada uno sigue siendo rastreable a una skill.
export const DEFAULT_RUBRICS: RoomRubrics = Object.fromEntries(ROOMS.map(room => [room.id, BASE_RUBRICS[room.id].map(axis => ({
  ...axis,
  enabled: true,
  ...(traceOf(room.id, axis.id) ?? { source: 'metodo-wdc' as const, source_ref: 'SKILL.md' }),
}))])) as RoomRubrics;

// Orden de impacto del método: primero lo que hace que la venta no exista, después la ejecución.
// El feedback elige UNA y no recorre la lista.
export const DEFAULT_PRIORITIES: string[] = [
  'No se cavó el dolor ni se cuantificó el coste de seguir igual.',
  'Se presentó la oferta antes de cualificar tiempo, dinero y confianza.',
  'La primera objeción se respondió sin aislar la de verdad.',
  'No se pidió la decisión o se abandonó tras el primer no.',
  'Se bajó el precio o se justificó sin que lo pidieran.',
  'Habló más que la clienta o presentó de más.',
  'El siguiente paso quedó sin día y hora.',
  'Tono y ritmo: rápido, a la defensiva o rellenando silencios.',
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
      if (source !== 'metodo-wdc' && source !== 'scalix-ventas' && source !== 'analisis-llamadas-ventas') {
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
      if (!isRecord(value)) return { ok: false, detail: 'La configuración de la cualificación debe ser un objeto por sala.' };
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
