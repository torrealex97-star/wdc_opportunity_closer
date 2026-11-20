// «¿Dónde se enseña esto?» sin modelo y sin coste: busca en el índice del Classroom (§0.2 y §0.3 de la
// skill `metodo-wdc`) y devuelve módulo, lección, duración y recurso de cada clase que responde.
// Es determinista: el mismo texto da siempre el mismo resultado, y lo que no está en el mapa no se inventa.
import { CLASSROOM_MODULES, CLASSROOM_TOPICS } from './classroomMap';
import type { ClassroomModule, ClassroomTopic } from './classroomMap';
import { TRAINING_COURSES } from './trainingCourses';
import { classLink, courseLink } from './skoolClass';

export type WhereResult = {
  /** El tema del mapa por el que ha salido (`''` si no hubo coincidencia). */
  topic: ClassroomTopic | null;
  score: number;
  module: { order: number; name: string; duration: string; url: string | null };
  lesson: { id: string; title: string; duration: string };
  /** Primer material enlazado de la clase; `null` cuando la lección es solo vídeo. */
  resource: { name: string; url: string } | null;
  /** Enlace a la clase concreta en Skool (o al módulo si la hoja no trae el de la lección). */
  skool: string | null;
};

// Palabras que no distinguen un tema de otro. Lista corta y cerrada: nada de modelos.
const STOP = new Set('de la el los las un una unos unas que y o en con por para sin sobre entre es son esta estan este esto como cuando donde porque mas muy pero si no al del lo se su sus tu tus te me nos le les hay ser estoy tiene tienes tengo hacer hago haces puedo puede puedes quiero quieres darme dame decir dime cosa cosas algo algun alguna esta estoy soy ensena ensenan ensenais aprendo aprende aprenden ver veo damelo'.split(' '));

/** Vocabulario de la alumna → palabras del mapa. Determinista y a la vista; sin esto, «no-show» no casa. */
const ALIASES: Record<string, string[]> = {
  noshow: ['confirmar', 'llamada'],
  show: ['confirmar', 'llamada'],
  planton: ['confirmar', 'llamada'],
  ratio: ['metricas'],
  ratios: ['metricas'],
  cv: ['curriculum'],
  pitch: ['presentacion', 'oferta'],
  discovery: ['cualificacion'],
  temario: ['mapa'],
  clase: ['leccion'],
};

export const normalizeClassroom = (text: string) => text
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/-/g, ' ')
  .replace(/[^a-z0-9ñ.\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Raíz suficiente para que «objeción» y «objeciones» se encuentren, sin diccionario ni modelo. */
export const stem = (word: string) => {
  let root = word;
  if (root.length > 5 && root.endsWith('es')) root = root.slice(0, -2);
  else if (root.length > 4 && root.endsWith('s')) root = root.slice(0, -1);
  // «confirmar» y «confirmo» son la misma palabra para quien busca; también «precio» y «precios».
  if (root.length > 5 && /(ar|er|ir)$/.test(root)) root = root.slice(0, -2);
  else if (root.length > 5 && root.endsWith('o')) root = root.slice(0, -1);
  return root;
};

export const terms = (text: string): string[] => [...new Set(
  normalizeClassroom(text).split(/[\s.]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word))
    .flatMap((word) => [word, ...(ALIASES[word] ?? [])])
    .map(stem),
)];

// Índice construido una vez: por cada tema, sus raíces y una frase para la coincidencia exacta.
const titleById = new Map(TRAINING_COURSES.flatMap((course) => course.lessons.map((lesson) => [lesson.id, lesson.title] as const)));
const INDEX = CLASSROOM_TOPICS.map((topic) => {
  const haystack = normalizeClassroom([
    topic.topic,
    topic.teaches,
    ...topic.lessons.map((id) => titleById.get(id) ?? ''),
  ].join(' '));
  return { topic, haystack, roots: new Set(haystack.split(/[\s.]+/).filter((word) => word.length >= 3).map(stem)) };
});
const DF = new Map<string, number>();
for (const entry of INDEX) for (const root of entry.roots) DF.set(root, (DF.get(root) ?? 0) + 1);
const idf = (root: string) => Math.log(1 + INDEX.length / (DF.get(root) ?? INDEX.length));

const courseByOrder = new Map(TRAINING_COURSES.map((course) => [course.order, course] as const));
const moduleByOrder = new Map(CLASSROOM_MODULES.map((item: ClassroomModule) => [item.order, item] as const));

/** La clase con sus datos reales (duración y recurso salen de la hoja; el tema, del mapa). */
function classOf(lessonId: string, topic: ClassroomTopic | null, score: number): WhereResult | null {
  const order = Number(lessonId.split('.')[0]);
  const course = courseByOrder.get(order);
  const lesson = course?.lessons.find((item) => item.id === lessonId);
  const classroomModule = moduleByOrder.get(order);
  if (!course || !lesson || !classroomModule) return null;
  const link = classLink(course, lesson);
  return {
    topic,
    score: Number(score.toFixed(2)),
    module: { order, name: classroomModule.name, duration: classroomModule.duration, url: courseLink(course)?.url ?? null },
    lesson: { id: lesson.id, title: lesson.title, duration: lesson.duration },
    resource: lesson.resources[0] ?? null,
    skool: link?.url ?? null,
  };
}

/**
 * Devuelve las clases donde se enseña lo que se pregunta, de más a menos ajuste. Vacío si el mapa no
 * tiene ese tema: es preferible decir «no está» a mandar a una clase que no habla de eso.
 */
export function whereTaught(query: string, limit = 5): WhereResult[] {
  const wanted = terms(query);
  if (!wanted.length) return [];
  const exact = normalizeClassroom(query);

  const scored = INDEX.map(({ topic, haystack, roots }) => {
    let score = 0;
    for (const root of wanted) if (roots.has(root)) score += idf(root);
    // La frase entera pesa más que las palabras sueltas: «objeción de pareja» no es «objeción».
    if (exact.length >= 6 && haystack.includes(exact)) score += 6;
    return { topic, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.topic.topic.localeCompare(b.topic.topic));

  const results: WhereResult[] = [];
  const seen = new Set<string>();
  for (const { topic, score } of scored) {
    for (const lessonId of topic.lessons) {
      if (seen.has(lessonId)) continue;
      const item = classOf(lessonId, topic, score);
      if (!item) continue;
      seen.add(lessonId);
      results.push(item);
      if (results.length >= limit) return results;
    }
  }
  return results;
}
