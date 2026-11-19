// Criterios de la sala de práctica. Módulo PURO (sin Supabase ni red): lo importan el servidor
// (prompts y validación del feedback) y el panel de administración, que edita estos valores.
//
// Las rúbricas no son una invención del producto: se copian de las skills `scalix-ventas` y
// `analisis-llamadas-ventas` (instaladas en `.agents/skills/`), que a su vez se apoyan en el Ultimate
// Sales Blueprint. Pesos por tipo de llamada: rubrica.md §1. El feedback termina siempre en UNA
// corrección prioritaria (§Paso 4) porque «de 28 cosas mal en una llamada, solo una mueve el cierre».
export type PracticeRoom = 'venta' | 'setter' | 'frio' | 'entrevista' | 'wdc-entrevista';
export type RubricAxis = { id: string; label: string; guide: string; weight: number };
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
  { id: 'entrevista', label: 'Entrevista · criterios generales', note: 'Criterios de contratación de closers (scalix-ventas §7): números, criterio y 3 P.' },
  { id: 'wdc-entrevista', label: 'Entrevista · rúbrica WDC', note: 'Seis criterios con peso, para las entrevistas por perfil.' },
];

export const MIN_AXES = 3;
export const MAX_AXES = 8;
export const MAX_AXIS_WEIGHT = 100;
const AXIS_ID = /^[a-z][a-z0-9_]{1,29}$/;

// Pesos y criterios copiados de `analisis-llamadas-ventas/references/rubrica.md`.
// 0/1/2 por criterio se estima aquí en 0-100 para que la alumna vea una escala continua; el prompt
// traduce las bandas (0-40 ausente o dañino, 41-60 parcial, 61-80 correcto, 81-100 sólido).
export const DEFAULT_RUBRICS: RoomRubrics = {
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
      id: 'evidencia', label: 'Evidencia y cifras', weight: 25,
      guide: 'Usa un caso concreto con resultado (STAR) y cifras propias. Si algo no lo medía, lo dice y explica cómo lo mediría ahora; no infla datos.',
    },
    {
      id: 'criterio', label: 'Criterio comercial', weight: 25,
      guide: 'Razona sobre métricas, cualificación y escalabilidad en vez de recitar frameworks. Conecta lo que hizo con la métrica que movía y propone una hipótesis propia.',
    },
    {
      id: 'claridad', label: 'Claridad y estructura', weight: 20,
      guide: 'Responde directo y ordenado, sin rodeos ni relleno. Una respuesta de treinta segundos con estructura vale más que tres minutos de contexto.',
    },
    {
      id: 'objecion', label: 'Objeciones y encaje', weight: 15,
      guide: 'Reconoce la pega (experiencia, sector, huecos) sin ponerse a la defensiva y responde con un plan de rampa concreto y una prueba transferible.',
    },
    {
      id: 'iniciativa', label: 'Iniciativa y cierre', weight: 15,
      guide: 'Hace preguntas de negocio y propone un siguiente paso con fecha. Demuestra que entiende cómo trabaja esa empresa, no que quiere cualquier trabajo.',
    },
  ],
  'wdc-entrevista': [
    { id: 'confianza', label: 'Confianza y autoridad', weight: 25, guide: 'Proyecta seguridad sin arrogancia; controla el tono y el ritmo.' },
    { id: 'claridad', label: 'Claridad y estructura', weight: 20, guide: 'Responde directo y ordenado, sin divagar.' },
    { id: 'evidencia', label: 'Evidencia y cifras', weight: 20, guide: 'Respalda con datos propios y casos reales; no infla lo que no puede justificar.' },
    { id: 'objecion', label: 'Manejo de objeciones', weight: 15, guide: 'Convierte la pregunta difícil o la desconfianza en una oportunidad, sin defenderse.' },
    { id: 'encaje', label: 'Encaje', weight: 10, guide: 'Demuestra que entiende cómo trabaja esa empresa y que no es un trabajo más.' },
    { id: 'iniciativa', label: 'Cierre e iniciativa', weight: 10, guide: 'Termina con una pregunta poderosa o un siguiente paso concreto.' },
  ],
};

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
export const DEFAULT_BANT: BantConfig = { venta: true, setter: true, frio: true, entrevista: false, 'wdc-entrevista': false };

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

export const roomOf = (kind: 'venta' | 'setter' | 'frio' | 'entrevista', rubric?: 'wdc-entrevista'): PracticeRoom =>
  rubric === 'wdc-entrevista' ? 'wdc-entrevista' : kind;

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
      if (!AXIS_ID.test(id)) return { ok: false, detail: `${room.label}: el id «${id || '(vacío)'}» no es válido (minúsculas, números y guion bajo).` };
      if (ids.has(id)) return { ok: false, detail: `${room.label}: el criterio «${id}» está repetido.` };
      if (!label) return { ok: false, detail: `${room.label}: el criterio «${id}» no tiene nombre.` };
      if (!guide) return { ok: false, detail: `${room.label}: el criterio «${label}» no tiene guía.` };
      if (!Number.isFinite(weight) || weight < 1 || weight > MAX_AXIS_WEIGHT) {
        return { ok: false, detail: `${room.label}: el peso de «${label}» debe estar entre 1 y ${MAX_AXIS_WEIGHT}.` };
      }
      ids.add(id);
      axes.push({ id, label, guide, weight });
    }
    const total = axes.reduce((sum, axis) => sum + axis.weight, 0);
    if (total < MIN_AXES) return { ok: false, detail: `${room.label}: la suma de pesos es demasiado baja (${total}).` };
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

export const axesForRoom = (room: PracticeRoom, rubrics: RoomRubrics = DEFAULT_RUBRICS): RubricAxis[] => rubrics[room];

/** Media ponderada por los pesos de la rúbrica; se normaliza, así los pesos no tienen que sumar 100. */
export function weightedScore(axes: Array<{ id: string; score: number }>, rubric: RubricAxis[]): number {
  const weights = new Map(rubric.map(axis => [axis.id, axis.weight]));
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
