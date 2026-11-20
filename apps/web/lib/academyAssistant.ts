// Asistente de la academia (RAG sobre la skill `metodo-wdc`). Módulo PURO: sin red, sin base de datos
// y sin leer el disco. La ruta solo pone la sesión, la cuota y la clave del proveedor.
//
// Reglas que gobiernan este fichero:
// 1. La única fuente es `wdcKnowledge.ts`, generado del SKILL.md de la academia. Si la pregunta no
//    toca ningún trozo, NO se llama al modelo: se dice que eso no está en la formación.
// 2. El modelo no puede citar un trozo que no se le ha dado: se validan los ids que devuelve.
// 3. Las respuestas hablan como la academia (español de España, tuteo, closer/clienta) y no prometen
//    resultados ni inventan cifras: las cifras del material son de clase, no metas.
import { WDC_KNOWLEDGE, type KnowledgeChunk } from './wdcKnowledge';
import { whereTaught } from './classroomSearch';

export type { KnowledgeChunk };

/** Tope de trozos que viajan al modelo: más contexto no mejora la respuesta y encarece la llamada. */
export const MAX_CHUNKS = 5;
/** Pregunta y respuesta acotadas para que una consulta no se convierta en un documento. */
export const MAX_QUESTION_CHARS = 500;
export const MAX_ANSWER_CHARS = 1600;
/** Por debajo de esta puntuación no hay recuperación: se responde «no está en la formación». */
const MIN_SCORE = 6;

const STOPWORDS = new Set([
  'que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'con', 'por', 'para',
  'es', 'son', 'ser', 'esta', 'este', 'esto', 'estos', 'estas', 'como', 'cómo', 'que', 'qué', 'cuando',
  'cuándo', 'donde', 'dónde', 'porque', 'pero', 'si', 'no', 'mi', 'me', 'te', 'se', 'lo', 'le', 'les',
  'del', 'al', 'más', 'mas', 'muy', 'ya', 'hay', 'hacer', 'hago', 'hace', 'tengo', 'tiene', 'soy', 'estoy',
  'puedo', 'puede', 'debo', 'debe', 'quiero', 'quiere', 'algo', 'eso', 'esa', 'ese', 'sus', 'su', 'tu', 'tus',
  'yo', 'él', 'ella', 'nos', 'os', 'les', 'le', 'mí', 'sí', 'también', 'solo', 'sólo', 'todo', 'toda', 'bien',
]);

/** Minúsculas, sin acentos y sin puntuación: la misma forma para la pregunta y para la skill. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // El guion se convierte en espacio: «no-show» tiene que encontrar «no show» y «show-rate».
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9ñ\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras con contenido de la pregunta. Las de menos de 3 letras no discriminan nada. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[\s.-]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

type Indexed = { chunk: KnowledgeChunk; title: string; body: string; length: number };

const INDEX: Indexed[] = WDC_KNOWLEDGE.map((chunk) => {
  const title = normalize(`${chunk.section} ${chunk.subsection ?? ''} ${chunk.title}`);
  // El encabezado del trozo ya está en `title`: si se cuenta también en el cuerpo, todas las partes de
  // una sección larga puntúan igual y llenan el top-3 con la sección equivocada repetida.
  const lines = chunk.text.split('\n');
  const body = normalize(lines[0]?.startsWith('#') ? lines.slice(1).join('\n') : chunk.text);
  return { chunk, title, body, length: body.split(' ').length };
});
const AVG_LENGTH = INDEX.reduce((sum, item) => sum + item.length, 0) / Math.max(INDEX.length, 1);
const DOC_FREQ = new Map<string, number>();
for (const item of INDEX) {
  for (const token of new Set(tokenize(item.title + ' ' + item.body))) {
    DOC_FREQ.set(token, (DOC_FREQ.get(token) ?? 0) + 1);
  }
}

/** Cuenta coincidencias por prefijo: «pensarlo» encuentra «pensar» y «cierro», «cierre». */
function countTerm(haystack: string, term: string): number {
  let count = 0;
  for (const word of haystack.split(' ')) {
    if (word === term) count += 1;
    else if (word.length >= 4 && term.length >= 4 && (word.startsWith(term) || term.startsWith(word))) count += 0.6;
  }
  return count;
}

/**
 * El vocabulario de la alumna no siempre es el de la academia («caro» por «precio», «lo pienso» por
 * «lo tengo que pensar»). Se amplía la consulta con estos equivalentes para no perder la lección que
 * sí habla del tema; nunca se amplía hacia fuera de la formación.
 */
export const SYNONYMS: Record<string, string[]> = {
  // Miedo y rechazo: la alumna pregunta por lo que siente, no por la lección.
  miedo: ['rechazo', 'verguenza', 'confianza', 'estadistico', 'capaz', 'inseguridad'],
  verguenza: ['miedo', 'rechazo', 'autoridad'],
  molestar: ['miedo', 'rechazo', 'llamar'],
  rechazo: ['miedo', 'estadistico', 'personal', 'no'],
  // Autoridad y aprobación.
  caer: ['simpatia', 'aprobar', 'aprobacion', 'autoridad'],
  simpatia: ['aprobar', 'aprobacion', 'autoridad', 'caer'],
  aprobar: ['aprobacion', 'simpatia', 'autoridad'],
  // Cualificación con el vocabulario de la alumna.
  interrogando: ['interrogatorio', 'preguntas', 'cualificacion'],
  interrogatorio: ['preguntas', 'cualificacion', 'descubrimiento'],
  brecha: ['coste', 'numeros', 'inaccion', 'diferencia', 'cualificacion'],
  coste: ['brecha', 'inaccion', 'numeros'],
  suavizo: ['suavizar', 'preguntas', 'cualificacion'],
  // Seguimiento y cita.
  confirmar: ['cita', 'noshow', 'agenda'],
  confirmo: ['confirmar', 'cita', 'agenda'],
  noshow: ['confirmar', 'cita', 'agenda'],
  agenda: ['cita', 'confirmar', 'calendario'],
  informacion: ['mandar', 'pensarlo', 'seguimiento', 'objecion'],
  mandar: ['informacion', 'pensarlo', 'objecion'],
  insistir: ['no', 'cierre', 'pedir'],
  // Apertura y marco.
  marco: ['estructura', 'apertura', 'confianza'],
  apertura: ['empezar', 'marco', 'saludo', 'confianza'],
  empezar: ['apertura', 'marco'],
  confianza: ['marco', 'apertura', 'generar'],
  // Valor y presentación.
  valor: ['mostrar', 'resultado', 'beneficio'],
  caracteristicas: ['valor', 'resultado', 'beneficio'],
  presionar: ['presion', 'cierre', 'error'],
  perdida: ['dolor', 'urgencia', 'psicologia'],
  numeros: ['metricas', 'brecha', 'ratio'],
  ratio: ['hablar', 'metricas', 'numeros'],
  empresas: ['captacion', 'prospeccion', 'grupos'],
  ofrecerme: ['candidatura', 'captacion', 'mensaje'],
  caro: ['precio', 'dinero', 'coste', 'inversion', 'objecion'],
  precio: ['caro', 'dinero', 'coste', 'inversion'],
  dinero: ['precio', 'caro', 'cuota', 'inversion'],
  pensar: ['pensarlo', 'tiempo', 'objecion'],
  pienso: ['pensarlo', 'objecion'],
  pareja: ['socio', 'marido', 'consultar', 'permiso'],
  socio: ['pareja', 'consultar', 'autoridad'],
  tiempo: ['prioridad', 'ocupada', 'agenda'],
  cierre: ['cerrar', 'pedir', 'venta', 'decidir', 'decision'],
  decision: ['cierre', 'decidir', 'cerrar'],
  vendo: ['vender', 'venta', 'valor'],
  explico: ['explicar', 'funciona', 'como'],
  resultado: ['valor', 'beneficio', 'transformacion'],
  cerrar: ['cierre', 'pedir', 'venta'],
  silencio: ['callar', 'pausa'],
  seguimiento: ['recordatorio', 'noventa', 'fases'],
  objecion: ['excusa', 'pero', 'objeciones'],
  objeciones: ['objecion', 'excusa'],
  autoridad: ['marco', 'asertiva', 'tono'],
  descubrimiento: ['preguntas', 'dolor', 'diagnostico', 'discovery'],
  discovery: ['descubrimiento', 'preguntas', 'cualificacion'],
  preguntas: ['descubrimiento', 'cualificacion', 'interrogatorio'],
  frase: ['guion', 'decir', 'como'],
  cualificar: ['presupuesto', 'prioridad', 'tiempo', 'dinero', 'confianza', 'cualificacion'],
  roleplay: ['practica', 'ejercicio'],
  formacion: ['modulo', 'leccion', 'clase'],
  curriculum: ['captacion', 'entrevista', 'cv'],
  cv: ['curriculum', 'captacion', 'entrevista'],
  llamada: ['apertura', 'marco', 'fases'],
  error: ['errores', 'fallo'],
  metrica: ['metricas', 'ratio', 'numeros'],
};

/**
 * Buscador de temas de la academia (§0.3) traducido a código: la alumna pregunta con sus palabras y
 * aquí se dice qué sección del método y qué lección del Classroom responden. Las entradas de una sola
 * palabra pesan menos (`weight`) que las frases, para que «psicología del precio» no acabe en la
 * objeción de precio. Es un refuerzo: sin coincidencia léxica no rescata un trozo por sí solo.
 */
export type TopicHint = { match: RegExp; section?: string; lesson?: string; weight: number };
export const TOPIC_HINTS: TopicHint[] = [
  // Identidad y mentalidad.
  { match: /\b(miedo|rechazo|verguenza|estadistico)\b/, section: '1-identidad-y-mentalidad--1-2-el-rechazo-es-estadistico-no-personal', lesson: '3.2', weight: 9 },
  { match: /\b(me da cosa|molestar|da apuro)\b/, section: '1-identidad-y-mentalidad--1-3-el-problema-del-prospecto-es-mas-grande-que-tu-miedo', lesson: '3.2', weight: 9 },
  { match: /\b(caer bien|simpatia|aprobar|aprobacion)\b/, section: '1-identidad-y-mentalidad--1-9-el-sesgo-de-aprobacion-por-que-cuesta-la-autoridad-a-las-mujeres', lesson: '3.5', weight: 9 },
  { match: /\b(merecimiento|merezco|cobrar)\b/, section: '1-identidad-y-mentalidad--1-8-dinero-y-merecimiento', lesson: '3.6', weight: 8 },
  { match: /\b(antes de la llamada|preparar la llamada|ritual)\b/, section: '1-identidad-y-mentalidad--1-7-ritual-antes-de-la-llamada', lesson: '3.2', weight: 8 },
  { match: /\b(como empiezo|primeras frases|guion de apertura)\b/, section: '1-identidad-y-mentalidad--1-10-guion-de-cinco-lineas-y-banderas-rojas', lesson: '3.2', weight: 7 },
  // Fundamentos, valor y precio.
  { match: /\b(high ticket|mercado|alto valor)\b/, section: '2-fundamentos-del-high-ticket', lesson: '2.2', weight: 8 },
  { match: /\b(mostrar el valor|caracteristicas|resultado antes)\b/, section: '3-mostrar-el-valor', lesson: '2.5', weight: 9 },
  { match: /\b(psicologia del precio)\b/, section: '6-precio-descuento-y-autoridad', lesson: '2.4', weight: 14 },
  { match: /\b(descuento|bajar el precio|rebajar|no bajar)\b/, section: '6-precio-descuento-y-autoridad', lesson: '2.8', weight: 9 },
  // Comunicación.
  { match: /\b(hablar con autoridad|asertiva|agresiva)\b/, section: '4-comunicacion-con-autoridad', lesson: '2.6', weight: 8 },
  { match: /\b(palabras|perder autoridad)\b/, section: '4-comunicacion-con-autoridad', lesson: '2.9', weight: 8 },
  { match: /\b(silencio)\b/, section: '4-comunicacion-con-autoridad', lesson: '9.7', weight: 8 },
  { match: /\b(escucha activa|escuchar|nombrar|devolver)\b/, section: '4-comunicacion-con-autoridad', lesson: '9.9', weight: 8 },
  // Emoción y lógica.
  { match: /\b(logica|emocion)\b/, section: '5-emocion-y-logica', lesson: '2.7', weight: 8 },
  // Psicología de compra.
  { match: /\b(tres pilares|dolor|deseo|urgencia)\b/, section: '7-psicologia-de-compra', lesson: '5.3', weight: 7 },
  { match: /\b(niveles de conciencia|conciencia)\b/, section: '7-psicologia-de-compra', lesson: '4.5', weight: 8 },
  { match: /\b(tipos de clientes|dominante|esceptic)\b/, section: '7-psicologia-de-compra', lesson: '5.9', weight: 8 },
  { match: /\b(tono|ritmo)\b/, section: '7-psicologia-de-compra', lesson: '5.8', weight: 7 },
  { match: /\b(perdida)\b/, section: '7-psicologia-de-compra', lesson: '5.5', weight: 7 },
  { match: /\b(presionar|presion)\b/, section: '11-cierre', lesson: '5.7', weight: 6 },
  // Estructura.
  { match: /\b(marco|primeros minutos|generar confianza)\b/, section: '8-estructura-de-la-llamada', lesson: '6.2', weight: 8 },
  { match: /\b(estructura|orden de la llamada|fases)\b/, section: '8-estructura-de-la-llamada', lesson: '6.1', weight: 7 },
  // Cualificación.
  { match: /\b(hablo del precio|hablar del precio|momento del precio|cuando el precio)\b/, section: '9-cualificacion', lesson: '6.3', weight: 14 },
  { match: /\b(brecha|discovery|descubrimiento|interrogatorio|cualificar)\b/, section: '9-cualificacion', lesson: '6.3', weight: 8 },
  // Presentación y cierre.
  { match: /\b(presentar la oferta|pitch)\b/, section: '10-presentacion-de-la-oferta', lesson: '6.4', weight: 8 },
  { match: /\b(insistir|primer no|sostener la presion)\b/, section: '11-cierre', lesson: '6.8', weight: 9 },
  { match: /\b(cierre|cerrar|pedir la decision|pedir la venta|tipos de cierre)\b/, section: '11-cierre', lesson: '6.5', weight: 8 },
  // Objeciones.
  { match: /\b(prevenir|evitar|evito|anticipar)\b(?=[^?]{0,40}objecion)/, section: '12-objeciones--12-1-tesis-se-previenen-no-se-manejan', lesson: '6.9', weight: 12 },
  { match: /\b(video de presentacion|video presentacion|video de candidatura)\b/, section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.7', weight: 12 },
  { match: /\bno (tiene|tengo) dinero\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.2', weight: 12 },
  { match: /\b(fantasma)\b/, section: '12-objeciones--12-1-tesis-se-previenen-no-se-manejan', lesson: '6.10', weight: 10 },
  { match: /\b(que no debo hacer|como no responder|no responder)\b/, section: '12-objeciones--12-4-como-no-responder', lesson: '7.8', weight: 18 },
  { match: /\b(frases hechas|banco de frases|playbook)\b/, section: '12-objeciones--12-6-banco-de-frases-del-playbook', lesson: '7.9', weight: 10 },
  { match: /\b(pareja|socio|marido|consultar)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.5', weight: 9 },
  { match: /\b(capaz|inseguridad)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.6', weight: 7 },
  { match: /\b(otras opciones|valorar|comparar)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.7', weight: 7 },
  { match: /\b(probe|probado|no me funciono)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.8', weight: 7 },
  { match: /\b(no tengo tiempo|no tiene tiempo)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.4', weight: 8 },
  { match: /\b(caro|presupuesto)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.2', weight: 7 },
  { match: /\b(pensarlo|lo tengo que pensar)\b/, section: '12-objeciones--12-2-guion-de-tres-pilares-para-lo-tengo-que-pensar', lesson: '7.3', weight: 9 },
  { match: /\b(mandame|informacion)\b/, section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.9', weight: 7 },
  // Seguimiento y métricas.
  { match: /\b(seguimiento|recordatorio|seguir)\b/, section: '13-seguimiento', lesson: '8.3', weight: 7 },
  { match: /\b(noshow|confirmar la cita|confirmar|confirmo)\b/, section: '13-seguimiento', lesson: '8.4', weight: 9 },
  { match: /\b(metricas|ratio|porcentaje|hablar yo)\b/, section: '14-metricas', lesson: '8.6', weight: 9 },
  { match: /\b(crm|pipeline|calendly|calendario)\b/, section: '13-seguimiento', lesson: '8.5', weight: 7 },
  // Captación.
  { match: /\b(empresas|grupos|portales|prospeccion)\b/, section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.3', weight: 7 },
  { match: /\b(curriculum|cv)\b/, section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.2', weight: 8 },
  { match: /\b(entrevista)\b/, section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.9', weight: 6 },
  // Roleplay.
  { match: /\b(roleplay|practicar|practico|ensayar)\b/, section: '16-entrenamiento-y-roleplay-como-ensena-la-academia', lesson: '12.10', weight: 12 },
  // «¿Dónde se enseña…?» lo contesta el buscador de temas del mapa.
  { match: /\b(donde se ensena|donde lo aprendo|en que clase)\b/, section: '0-mapa-de-la-formacion-los-modulos-las-clases-y-donde-esta-cada-cosa--0-3-buscador-de-temas-si-preguntan-por', weight: 18 },
];

function expand(terms: string[]): string[] {
  const out = new Set(terms);
  for (const term of terms) {
    for (const [key, values] of Object.entries(SYNONYMS)) {
      if (term === key || term.startsWith(key) || key.startsWith(term)) values.forEach((value) => out.add(value));
    }
  }
  return [...out].slice(0, 22);
}

export type Retrieved = { chunk: KnowledgeChunk; score: number; terms: string[] };

/**
 * Recupera los trozos que hablan de la pregunta (BM25 simplificado, sin dependencias).
 * Devuelve [] cuando no hay coincidencia: quien llama decide no gastar una llamada al modelo.
 */
/**
 * Preguntas que la formación no responde nunca (precio del programa, garantías, datos de otras
 * alumnas). Se cortan antes de buscar: responderlas con un trozo de método sería inventar.
 */
const OFF_PROGRAMME = /(cuanto (cuesta|vale) (el|este|la) (programa|curso|formacion|academia)|precio del (programa|curso|academia)|garantiz|garantia de resultados|nota[^?]{0,40}alumna|datos de (la|otra) alumna)/;

export function retrieve(question: string, limit = MAX_CHUNKS): Retrieved[] {
  if (OFF_PROGRAMME.test(normalize(question))) return [];
  const terms = expand([...new Set(tokenize(question))]);
  if (!terms.length) return [];
  // Las frases de la pregunta («es muy caro», «lo tengo que pensar») pesan más que las palabras
  // sueltas: son las que distinguen una objeción de una mención de pasada.
  const words = normalize(question).split(' ').filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  const bigrams = words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`);
  // Si la pregunta cita una lección («7.5», «6.3»), ese trozo manda: es el índice del Classroom.
  const codes = [...new Set((normalize(question).match(/\b\d{1,2}\.\d{1,2}\b/g) ?? []))];
  // Las preguntas de «¿dónde se enseña…?» las contesta el mapa (§0); el resto, no.
  const asksWhere = /donde|en que modulo|que leccion|que clase/.test(normalize(question));
  const plain = normalize(question);
  const topicHints = TOPIC_HINTS.filter((hint) => hint.match.test(plain));
  // El buscador del mapa del Classroom (§0.3) hace de enrutador: si la pregunta coincide con un tema
  // del índice, la clase que lo enseña manda sobre el resto. Esto arregla los falsos amigos del
  // vocabulario —«orden de la llamada» puntuaba en Cualificación y «tres pilares» en el guion de
  // «lo tengo que pensar»— sin tocar el texto ni inventar sinónimos a mano.
  const routed = whereTaught(question, 3).filter((route) => route.score >= 3);
  const scored = INDEX.map((item) => {
    let score = 0;
    const matched: string[] = [];
    let hinted = false;
    for (const term of terms) {
      const inBody = countTerm(item.body, term);
      const inTitle = countTerm(item.title, term);
      const df = DOC_FREQ.get(term) ?? 1;
      const idf = Math.log(1 + INDEX.length / df);
      if (inBody || inTitle) matched.push(term);
      const tf = Math.min(inBody, 6);
      const norm = 1.2 * (0.25 + 0.75 * (item.length / Math.max(AVG_LENGTH, 1)));
      score += idf * ((tf * 2.2) / (tf + norm)) + idf * inTitle * 3;
    }
    for (const bigram of bigrams) {
      if (item.body.includes(` ${bigram} `) || item.title.includes(` ${bigram} `)) score += 1.8;
    }
    // Una pregunta por «dónde se enseña X» se contesta con el mapa del Classroom (§0).
    if (asksWhere && /^0[.\s]|Mapa de la formacion/i.test(item.title)) score += 2.5;
    // El mapa, el índice, los límites y el roce con otras skills nombran todos los temas: sin esta
    // corrección ganan casi cualquier pregunta por acumulación de palabras y citan una tabla de
    // inventario cuando la alumna pide el método.
    const mapLike = /^0[.\s]|^17[.\s]|^18[.\s]|^19[.\s]|^Introducción|^De dónde sale|^Cuándo |^Cómo leer/.test(item.chunk.section);
    if (mapLike) score *= asksWhere ? 1.1 : 0.45;
    for (const code of codes) if (item.chunk.lessons.includes(code)) score += 6;
    // Refuerzo por el buscador de temas de la academia: si la alumna nombra un tema del índice, el
    // trozo que cita esa lección sube aunque el material use otras palabras.
    for (const hint of topicHints) {
      if (hint.section && item.chunk.id.startsWith(hint.section)) { score += hint.weight; hinted = true; }
      if (hint.lesson && item.chunk.lessons.includes(hint.lesson)) score += Math.round(hint.weight / 2);
    }
    // Cada clase que propone el índice del Classroom empuja los trozos que la citan: el método y la
    // lección vienen del mismo mapa, así que no pueden contradecirse. La primera clase manda sobre
    // las palabras sueltas («orden de la llamada» dejar de puntuar en Cualificación por repetir
    // «llamada»); la segunda solo desempata.
    // El mapa (§0) lista las 130 lecciones: citarlas no es hablar del tema, así que no recibe este empuje.
    if (!mapLike) {
      for (const [rank, route] of routed.entries()) {
        if (!item.chunk.lessons.includes(route.lesson.id)) continue;
        score += rank === 0 ? 14 : 5;
        hinted = true;
      }
    }
    // El guion de tres pilares de §12.2 es la respuesta a «lo tengo que pensar», no a la psicología de
    // compra: sin una pista de objeción, no puede ganar una pregunta sobre los pilares de la venta.
    if (item.chunk.id.startsWith('12-objeciones--12-2') && !/pensar|pienso|pensarlo|tiempo/.test(plain)) score *= 0.35;
    return { chunk: item.chunk, score: Number(score.toFixed(2)), terms: matched, hinted };
  });
  const selected: Retrieved[] = [];
  const perSection = new Map<string, number>();
  for (const item of scored
    // Una sola palabra compartida no basta para decir que el trozo habla de la pregunta: hacen falta
    // al menos dos términos, o uno largo y específico. Así «receta de paella» no encuentra nada.
    .filter((item) => item.score >= MIN_SCORE && (item.terms.length >= 2 || item.terms.some((term) => term.length >= 7) || item.hinted))
    .sort((a, b) => b.score - a.score)) {
    // Dos trozos de la misma sección como mucho: si no, una sección partida ocupa el top-3 entero y la
    // respuesta cita tres veces lo mismo en vez de la sección que toca.
    const used = perSection.get(item.chunk.section) ?? 0;
    if (used >= 2) continue;
    perSection.set(item.chunk.section, used + 1);
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected;
}

export const ASSISTANT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'used_chunks', 'in_programme'],
  properties: {
    answer: { type: 'string' },
    used_chunks: { type: 'array', items: { type: 'string' } },
    in_programme: { type: 'boolean' },
  },
} as const;

export type AssistantContext = { lessonTitle?: string | null; room?: 'formacion' | 'practica' | 'revision' | 'general' };

export function buildMessages(question: string, retrieved: Retrieved[], context: AssistantContext = {}) {
  const system = [
    'Eres la asistente de la formación de Women Digital Closers (WDC). Respondes a una alumna.',
    'Hablas español de España, tuteas, usas frases cortas y el vocabulario de la academia: closer, clienta, llamada, marco, brecha, dolor, deseo, urgencia, objeción, cierre, micro cierre, seguimiento.',
    'Reglas estrictas:',
    '1. Responde SOLO con lo que dicen los extractos. No añadas métodos, cifras, plazos ni resultados que no aparezcan.',
    '2. Si los extractos no contestan la pregunta, dilo con claridad («eso no está en la formación») y ofrece lo más cercano que sí esté.',
    '3. Cuando el extracto marque un contenido como [COMPLEMENTO], di que no es material propio de WDC.',
    '4. Si te preguntan dónde se enseña algo, da módulo y lección con su nombre (por ejemplo «módulo 7, lección 7.3, “Objeción - Lo tengo que pensar”»).',
    '5. Nada de promesas de resultados, garantías ni importes inventados: las cifras del material son referencias de clase, no metas.',
    '6. Máximo 180 palabras. Nada de markdown con tablas; como mucho una lista corta.',
    '7. Devuelve también los ids de los extractos que hayas usado, y en «in_programme» si la pregunta quedó contestada con la formación.',
  ].join('\n');
  const context_lines: string[] = [];
  const room_label = context.room === 'practica' ? 'la sala de práctica' : context.room === 'formacion' ? 'la formación' : context.room === 'revision' ? 'la revisión de una llamada' : 'la app';
  if (context.room) context_lines.push(`La alumna está en: ${room_label}.`);
  if (context.lessonTitle) context_lines.push(`Lección abierta: ${context.lessonTitle}.`);
  const excerpts = retrieved.map((item, index) => [
    `[${index + 1}] id=${item.chunk.id} · ${item.chunk.title}`,
    item.chunk.text.slice(0, 2200),
  ].join('\n')).join('\n\n');
  const user = [
    context_lines.length ? `${context_lines.join('\n')}\n` : '',
    'Extractos de la formación:',
    excerpts,
    '',
    'Pregunta de la alumna:',
    question.trim(),
  ].join('\n');
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

export type AssistantAnswer = {
  answer: string;
  sources: Array<{ id: string; title: string; section: string; lessons: string[] }>;
  inProgramme: boolean;
  /** Lecciones del Classroom que citan las fuentes, para enlazar «dónde se enseña» sin inventarlo. */
  lessons: string[];
  /** Lo que la alumna puede hacer si la respuesta no cubre su duda. */
  nextStep: string | null;
};

export const NOT_IN_PROGRAMME = 'Eso no está en la formación de la academia tal como la tengo cargada. Puedo decirte lo que sí se enseña sobre el tema si me lo acercas un poco más («precio», «seguimiento», «objeción de pareja»…).';

/** Normaliza la salida del modelo y tira cualquier fuente inventada. */
export function cleanAnswer(raw: string, retrieved: Retrieved[]): AssistantAnswer | null {
  const allowed = new Map(retrieved.map((item) => [item.chunk.id, item.chunk]));
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const data = parsed as Record<string, unknown>;
  const text = typeof data.answer === 'string' ? data.answer.replace(/\r/g, '').trim().slice(0, MAX_ANSWER_CHARS) : '';
  if (!text) return null;
  const usedIds = Array.isArray(data.used_chunks) ? data.used_chunks.filter((id): id is string => typeof id === 'string') : [];
  const sources = [...new Set(usedIds)]
    .map((id) => allowed.get(id))
    .filter((chunk): chunk is KnowledgeChunk => Boolean(chunk))
    .map((chunk) => ({ id: chunk.id, title: chunk.title, section: chunk.section, lessons: chunk.lessons }));
  const inProgramme = data.in_programme === true;
  return {
    answer: text,
    sources,
    inProgramme,
    lessons: [...new Set(sources.flatMap((source) => source.lessons))].slice(0, 8),
    nextStep: inProgramme ? null : (sources.length ? 'Puedes abrir la sección citada y seguir desde ahí.' : NOT_IN_PROGRAMME),
  };
}

/** Comprueba que la pregunta tiene algo que ver con la formación antes de gastar una llamada. */
export function prepare(question: unknown, context: AssistantContext = {}): { ok: true; question: string; retrieved: Retrieved[] } | { ok: false; detail: string } {
  if (typeof question !== 'string') return { ok: false, detail: 'Escribe tu pregunta.' };
  const text = question.replace(/\s+/g, ' ').trim();
  if (text.length < 6) return { ok: false, detail: 'Escribe un poco más: con dos o tres palabras no sé qué buscas.' };
  if (text.length > MAX_QUESTION_CHARS) return { ok: false, detail: `La pregunta pasa de ${MAX_QUESTION_CHARS} caracteres. Resume un poco.` };
  const query = [text, context.lessonTitle ?? ''].filter(Boolean).join(' ');
  const retrieved = retrieve(query);
  // `retrieve` ya devuelve vacío por debajo de MIN_SCORE: aquí solo se decide si se gasta la llamada.
  if (!retrieved.length) return { ok: false, detail: NOT_IN_PROGRAMME };
  return { ok: true, question: text, retrieved };
}
