#!/usr/bin/env node
// Importador de la Formación desde Excel (.xlsx, una hoja por entidad) o una carpeta de CSV.
//
//   node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs scripts/training-import.mjs \
//     --input docs/templates/training --version 2026-11-20            # dry-run: valida y resume
//   ... --input docs/templates/training --out .local/curriculum.json  # escribe el JSON validado
//   ... --input curriculum.xlsx --supabase                            # upsert idempotente (requiere claves)
//   ... --template docs/templates/training                            # regenera la plantilla CSV
//
// Reglas: TODO se valida antes de escribir; una fila mal formada no deja nada a medias. El upsert va por
// `id`, así que reimportar actualiza y no duplica. No borra filas que ya no estén en el Excel: podar es
// una operación destructiva que exige una orden aparte.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CURRICULUM, RESOURCE_TYPES, validateCurriculum } from '../apps/web/lib/trainingCurriculum.ts';

const SHEETS = ['modules', 'lessons', 'resources', 'questions'];
const HEADERS = {
  modules: ['id', 'position', 'title', 'description', 'objectives', 'deep_dive'],
  lessons: ['id', 'module_id', 'position', 'title', 'summary', 'minutes', 'content', 'key_points'],
  resources: ['id', 'lesson_id', 'type', 'title', 'description', 'url', 'content'],
  questions: ['id', 'lesson_id', 'position', 'type', 'prompt', 'options', 'correct', 'explanation'],
};

/** Parser CSV mínimo con comillas, comas y saltos de línea dentro de comillas (RFC 4180). */
export function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(line => line.some(value => value.trim() !== ''));
}

export function rowsToObjects(rows) {
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(value => String(value ?? '').trim().toLowerCase());
  const objects = rows.slice(1).filter(line => line.some(value => String(value ?? '').trim() !== '')).map(line => Object.fromEntries(headers.map((header, index) => [header, String(line[index] ?? '').trim()])));
  return { headers, rows: objects };
}

function missingHeaders(name, headers) {
  return HEADERS[name].filter(header => !headers.includes(header));
}

const splitList = (value) => String(value ?? '').split('|').map(item => item.trim()).filter(Boolean);
const number = (value) => { const n = Number(String(value ?? '').trim()); return Number.isFinite(n) ? n : null; };

/**
 * Convierte las cuatro hojas ya leídas en un currículo validado.
 * `sheets` = { modules: rows, lessons: rows, resources: rows, questions: rows } (filas sin cabecera).
 */
export function buildCurriculumFromSheets(sheets, version) {
  const errors = [];
  const parsed = {};
  for (const name of SHEETS) {
    const { headers, rows } = rowsToObjects(sheets[name] ?? []);
    const missing = missingHeaders(name, headers);
    if (missing.length) errors.push(`${name}: faltan columnas ${missing.join(', ')}`);
    if (!rows.length && !missing.length) errors.push(`${name}: no hay filas`);
    parsed[name] = rows;
  }
  if (errors.length) return { ok: false, errors };

  const modules = [];
  const moduleById = new Map();
  parsed.modules.forEach((row, index) => {
    const item = {
      id: row.id, position: number(row.position), title: row.title, description: row.description,
      objectives: splitList(row.objectives), ...(row.deep_dive ? { deep_dive: row.deep_dive } : {}),
      lessons: [],
    };
    if (moduleById.has(item.id)) errors.push(`modules[${index}]: id repetido ${item.id}`);
    moduleById.set(item.id, item); modules.push(item);
  });
  const lessonById = new Map();
  parsed.lessons.forEach((row, index) => {
    const module = moduleById.get(row.module_id);
    if (!module) { errors.push(`lessons[${index}]: module_id desconocido ${row.module_id}`); return; }
    const item = {
      id: row.id, position: number(row.position), title: row.title, summary: row.summary,
      minutes: number(row.minutes), content: row.content, key_points: splitList(row.key_points),
      resources: [], questions: [],
    };
    if (lessonById.has(item.id)) errors.push(`lessons[${index}]: id repetido ${item.id}`);
    lessonById.set(item.id, item); module.lessons.push(item);
  });
  parsed.resources.forEach((row, index) => {
    const lesson = lessonById.get(row.lesson_id);
    if (!lesson) { errors.push(`resources[${index}]: lesson_id desconocido ${row.lesson_id}`); return; }
    if (!RESOURCE_TYPES.includes(row.type)) { errors.push(`resources[${index}]: tipo desconocido ${row.type}`); return; }
    lesson.resources.push({
      id: row.id, type: row.type, title: row.title, description: row.description,
      ...(row.url ? { url: row.url } : {}), ...(row.content ? { content: row.content } : {}),
    });
  });
  parsed.questions.forEach((row, index) => {
    const lesson = lessonById.get(row.lesson_id);
    if (!lesson) { errors.push(`questions[${index}]: lesson_id desconocido ${row.lesson_id}`); return; }
    const options = splitList(row.options);
    const correct = options.indexOf(row.correct);
    if (correct < 0) errors.push(`questions[${index}]: «correct» debe ser el texto exacto de una opción`);
    lesson.questions.push({ id: row.id, type: row.type, prompt: row.prompt, options, correct, explanation: row.explanation, position: number(row.position) ?? 0 });
  });
  for (const module of modules) module.lessons.sort((a, b) => a.position - b.position);
  for (const lesson of lessonById.values()) lesson.questions.sort((a, b) => a.position - b.position);
  for (const lesson of lessonById.values()) lesson.questions = lesson.questions.map(({ position, ...question }) => question);
  if (errors.length) return { ok: false, errors };
  const curriculum = { version: String(version || new Date().toISOString().slice(0, 10)), modules };
  const checked = validateCurriculum(curriculum);
  return checked.ok ? { ok: true, curriculum: checked.value } : { ok: false, errors: checked.errors };
}

export function readCsvDirectory(directory) {
  const sheets = {};
  for (const name of SHEETS) {
    const file = path.join(directory, `${name}.csv`);
    if (!existsSync(file)) return { ok: false, errors: [`No existe ${file}`] };
    sheets[name] = parseCsv(readFileSync(file, 'utf8'));
  }
  return { ok: true, sheets };
}

export async function readXlsx(file) {
  const { default: readXlsxFile, readSheetNames } = await import('read-excel-file/node');
  let names;
  try { names = await readSheetNames(file); } catch (error) { return { ok: false, errors: [`No se pudo abrir ${file}: ${error.message}`] }; }
  const sheets = {};
  for (const name of SHEETS) {
    const actual = names.find(item => item.trim().toLowerCase() === name);
    if (!actual) return { ok: false, errors: [`El libro no tiene la hoja «${name}». Hojas: ${names.join(', ')}`] };
    try {
      sheets[name] = await readXlsxFile(file, { sheet: actual });
    } catch (error) {
      // Un libro dañado o una celda con una estructura que el lector no entiende se declara con su hoja;
      // no se convierte en un fallo sin contexto ni deja una importación a medias.
      return { ok: false, errors: [`No se pudo leer la hoja «${name}» de ${file}: ${error.message}`] };
    }
  }
  return { ok: true, sheets };
}

export async function readCurriculum(input) {
  if (!input) return { ok: false, errors: ['Falta --input <carpeta-csv | archivo.xlsx>'] };
  if (path.extname(input).toLowerCase() === '.xlsx') return readXlsx(input);
  return readCsvDirectory(input);
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csvList = (values) => (values ?? []).join(' | ');
export function curriculumToCsv(curriculum) {
  const out = Object.fromEntries(SHEETS.map(name => [name, []]));
  out.modules.push(HEADERS.modules.join(','));
  out.lessons.push(HEADERS.lessons.join(','));
  out.resources.push(HEADERS.resources.join(','));
  out.questions.push(HEADERS.questions.join(','));
  for (const module of curriculum.modules) {
    out.modules.push([module.id, module.position, module.title, module.description, csvList(module.objectives), module.deep_dive ?? ''].map(csvCell).join(','));
    for (const lesson of module.lessons) {
      out.lessons.push([lesson.id, module.id, lesson.position, lesson.title, lesson.summary, lesson.minutes, lesson.content, csvList(lesson.key_points)].map(csvCell).join(','));
      for (const resource of lesson.resources) out.resources.push([resource.id, lesson.id, resource.type, resource.title, resource.description, resource.url ?? '', resource.content ?? ''].map(csvCell).join(','));
      lesson.questions.forEach((question, index) => out.questions.push([question.id, lesson.id, index + 1, question.type, question.prompt, csvList(question.options), question.options[question.correct], question.explanation].map(csvCell).join(',')));
    }
  }
  return out;
}

export function writeCsvTemplate(directory, curriculum = DEFAULT_CURRICULUM) {
  mkdirSync(directory, { recursive: true });
  const files = curriculumToCsv(curriculum);
  for (const name of SHEETS) writeFileSync(path.join(directory, `${name}.csv`), `${files[name].join('\n')}\n`, 'utf8');
  return SHEETS.map(name => path.join(directory, `${name}.csv`));
}

export function planOf(curriculum) {
  const lessons = curriculum.modules.flatMap(module => module.lessons);
  return {
    version: curriculum.version,
    modules: curriculum.modules.length,
    lessons: lessons.length,
    resources: lessons.reduce((sum, lesson) => sum + lesson.resources.length, 0),
    questions: lessons.reduce((sum, lesson) => sum + lesson.questions.length, 0),
  };
}

export async function upsertCurriculum(curriculum, env = process.env) {
  const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para escribir en Supabase.');
  const org = env.TRAINING_ORG_ID || 'cloud-wdc';
  const now = new Date().toISOString();
  const post = async (table, rows) => {
    if (!rows.length) return;
    const response = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  };
  const modules = curriculum.modules.map(module => ({ id: module.id, org_id: org, position: module.position, title: module.title, description: module.description, objectives: module.objectives, deep_dive: module.deep_dive ?? null, updated_at: now }));
  const lessons = curriculum.modules.flatMap(module => module.lessons.map(lesson => ({ id: lesson.id, org_id: org, module_id: module.id, position: lesson.position, title: lesson.title, summary: lesson.summary, minutes: lesson.minutes, content: lesson.content, key_points: lesson.key_points, updated_at: now })));
  const resources = curriculum.modules.flatMap(module => module.lessons.flatMap(lesson => lesson.resources.map(resource => ({ id: resource.id, org_id: org, lesson_id: lesson.id, type: resource.type, title: resource.title, description: resource.description, url: resource.url ?? null, content: resource.content ?? null, updated_at: now }))));
  const questions = curriculum.modules.flatMap(module => module.lessons.flatMap(lesson => lesson.questions.map((question, index) => ({ id: question.id, org_id: org, lesson_id: lesson.id, position: index + 1, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, explanation: question.explanation, updated_at: now }))));
  await post('training_modules', modules);
  await post('training_lessons', lessons);
  await post('training_resources', resources);
  await post('training_questions', questions);
  return { modules: modules.length, lessons: lessons.length, resources: resources.length, questions: questions.length };
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? fallback;
  const inline = process.argv.find(item => item.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

async function main() {
  if (flag('help')) {
    console.log('Uso: training-import --input <carpeta-csv|archivo.xlsx> [--version YYYY-MM-DD] [--out archivo.json] [--supabase] [--template carpeta]');
    return 0;
  }
  if (flag('template')) {
    const dir = arg('template', 'docs/templates/training');
    const files = writeCsvTemplate(dir);
    console.log(`Plantilla CSV escrita en ${files.length} ficheros:\n${files.join('\n')}`);
    return 0;
  }
  const read = await readCurriculum(arg('input'));
  if (!read.ok) { console.error(read.errors.join('\n')); return 1; }
  const built = buildCurriculumFromSheets(read.sheets, arg('version'));
  if (!built.ok) { console.error(`No se importó nada. ${built.errors.length} error(es):\n${built.errors.join('\n')}`); return 1; }
  const plan = planOf(built.curriculum);
  console.log(`Válido: ${plan.modules} módulos, ${plan.lessons} lecciones, ${plan.resources} recursos, ${plan.questions} preguntas (versión ${plan.version}).`);
  const out = arg('out');
  if (!out && !flag('supabase')) { console.log('Dry-run: no se ha escrito nada. Usa --out <archivo.json> o --supabase.'); return 0; }
  if (out) {
    const target = path.resolve(out);
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = path.join(tmpdir(), `training-${process.pid}-${Date.now()}.json`);
    writeFileSync(temporary, `${JSON.stringify(built.curriculum, null, 2)}\n`, 'utf8');
    renameSync(temporary, target);
    console.log(`Currículo escrito en ${target}.`);
  }
  if (flag('supabase')) {
    const written = await upsertCurriculum(built.curriculum);
    console.log(`Supabase actualizado (upsert por id): ${written.modules} módulos, ${written.lessons} lecciones, ${written.resources} recursos, ${written.questions} preguntas.`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => process.exit(code)).catch(error => { console.error(error.message); process.exit(1); });
}
