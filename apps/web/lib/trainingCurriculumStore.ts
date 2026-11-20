import { DEFAULT_CURRICULUM, validateCurriculum, type Curriculum, type CurriculumQuestion, type CurriculumResource } from './trainingCurriculum';
import { ORG } from './external';
import { allowlistConfigured, serviceRest } from './supabaseAuth';

// Currículo de Formación: si Supabase está configurado y las tablas están migradas, manda la base;
// si no, se sirve la versión firmada en el repo y se declara el motivo. Un JSON inválido no se sirve a
// medias: se vuelve al currículo versionado (la alumna nunca ve una ruta rota por una importación mala).
export type LoadedCurriculum = { curriculum: Curriculum; source: 'db' | 'defaults'; reason: string | null };
const TTL_MS = 30_000;
let cache: { at: number; value: LoadedCurriculum } | null = null;

const defaults = (reason: string | null): LoadedCurriculum => ({ curriculum: DEFAULT_CURRICULUM, source: 'defaults', reason });
const asArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; } }
  return [];
};

type ModuleRow = { id: string; position: number; title: string; description: string; objectives: unknown; deep_dive: string | null; updated_at: string };
type LessonRow = { id: string; module_id: string; position: number; title: string; summary: string; minutes: number; content: string; key_points: unknown; updated_at: string };
type ResourceRow = { id: string; lesson_id: string; type: string; title: string; description: string; url: string | null; content: string | null; updated_at: string };
type QuestionRow = { id: string; lesson_id: string; position: number; type: string; prompt: string; options: unknown; correct: number; explanation: string; updated_at: string };

// La versión que se sirve es la fecha de la última importación (el `updated_at` más reciente de las cuatro
// tablas). Antes se enviaba `'db'`, que el validador rechaza por corto: el currículo bueno de la base caía
// siempre al del repositorio y lo declaraba «no válido».
const versionOf = (rows: Array<{ updated_at: string }>): string | null => {
  const latest = rows.reduce((max, row) => {
    const at = Date.parse(row.updated_at ?? '');
    return Number.isFinite(at) && at > max ? at : max;
  }, Number.NEGATIVE_INFINITY);
  return Number.isFinite(latest) ? new Date(latest).toISOString().slice(0, 10) : null;
};

async function rows<T>(table: string, select: string, order: string): Promise<T[] | null> {
  const response = await serviceRest(`${table}?org_id=eq.${ORG}&select=${select}&order=${order}`).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  return Array.isArray(body) ? body as T[] : null;
}

export async function loadTrainingCurriculum(force = false): Promise<LoadedCurriculum> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!allowlistConfigured()) return defaults(null);
  const [modules, lessons, resources, questions] = await Promise.all([
    rows<ModuleRow>('training_modules', 'id,position,title,description,objectives,deep_dive,updated_at', 'position.asc'),
    rows<LessonRow>('training_lessons', 'id,module_id,position,title,summary,minutes,content,key_points,updated_at', 'position.asc'),
    rows<ResourceRow>('training_resources', 'id,lesson_id,type,title,description,url,content,updated_at', 'id.asc'),
    rows<QuestionRow>('training_questions', 'id,lesson_id,position,type,prompt,options,correct,explanation,updated_at', 'position.asc'),
  ]);
  if (!modules || !lessons || !resources || !questions) {
    const value = defaults('No se pudo leer el currículo de la base (¿migración 20261120_training_curriculum.sql aplicada?). Se usa la versión del repositorio.');
    cache = { at: Date.now(), value };
    return value;
  }
  if (!modules.length) {
    const value = defaults('La base no tiene currículo importado todavía. Se usa la versión del repositorio.');
    cache = { at: Date.now(), value };
    return value;
  }
  const version = versionOf([...modules, ...lessons, ...resources, ...questions]);
  if (!version) {
    const value = defaults('El currículo de la base no tiene fecha de importación legible. Se usa la versión del repositorio.');
    cache = { at: Date.now(), value };
    return value;
  }
  const byLesson = new Map<string, { resources: CurriculumResource[]; questions: CurriculumQuestion[] }>();
  for (const lesson of lessons) byLesson.set(lesson.id, { resources: [], questions: [] });
  for (const resource of resources) {
    const bucket = byLesson.get(resource.lesson_id);
    if (!bucket) continue;
    bucket.resources.push({ id: resource.id, type: resource.type as CurriculumResource['type'], title: resource.title, description: resource.description, ...(resource.url ? { url: resource.url } : {}), ...(resource.content ? { content: resource.content } : {}) });
  }
  for (const question of questions) {
    const bucket = byLesson.get(question.lesson_id);
    if (!bucket) continue;
    bucket.questions.push({ id: question.id, type: question.type as CurriculumQuestion['type'], prompt: question.prompt, options: asArray<string>(question.options).map(String), correct: question.correct, explanation: question.explanation });
  }
  const assembled = {
    version,
    modules: modules.map(module => ({
      id: module.id,
      position: module.position,
      title: module.title,
      description: module.description,
      objectives: asArray<string>(module.objectives).map(String),
      ...(module.deep_dive ? { deep_dive: module.deep_dive } : {}),
      lessons: lessons.filter(lesson => lesson.module_id === module.id).map(lesson => ({
        id: lesson.id,
        position: lesson.position,
        title: lesson.title,
        summary: lesson.summary,
        minutes: lesson.minutes,
        content: lesson.content,
        key_points: asArray<string>(lesson.key_points).map(String),
        resources: byLesson.get(lesson.id)?.resources ?? [],
        questions: byLesson.get(lesson.id)?.questions ?? [],
      })),
    })),
  };
  const checked = validateCurriculum(assembled);
  if (!checked.ok) {
    const value = defaults(`El currículo guardado no es válido (${checked.errors[0]}). Se usa la versión del repositorio.`);
    cache = { at: Date.now(), value };
    return value;
  }
  const value: LoadedCurriculum = { curriculum: checked.value, source: 'db', reason: null };
  cache = { at: Date.now(), value };
  return value;
}
