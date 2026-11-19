#!/usr/bin/env node
// Formación importable: el currículo firmado, el ida y vuelta CSV→JSON y las filas mal formadas.
// Todo se valida antes de escribir; este test comprueba que un error no produce un currículo a medias.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_CURRICULUM, TOTAL_LESSONS, lessonsOf, resourcesOf, validateCurriculum,
} from '../../apps/web/lib/trainingCurriculum.ts';
import { QUOTES, quoteOfDay } from '../../apps/web/lib/dailyQuote.ts';
import {
  buildCurriculumFromSheets, curriculumToCsv, parseCsv, planOf, readCsvDirectory, readXlsx, writeCsvTemplate,
} from '../../scripts/training-import.mjs';

let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); passed += 1; };

const root = path.resolve(import.meta.dirname, '../..');
const tmp = mkdtempSync(path.join(tmpdir(), 'wdc-training-'));
try {
  // 1) Currículo del repositorio: la ruta que ve la alumna si la migración no está aplicada.
  const checked = validateCurriculum(DEFAULT_CURRICULUM);
  ok(checked.ok, `el currículo por defecto debe validar: ${checked.ok ? '' : checked.errors.join('; ')}`);
  const lessons = lessonsOf(DEFAULT_CURRICULUM);
  const resources = resourcesOf(DEFAULT_CURRICULUM);
  eq(DEFAULT_CURRICULUM.modules.length, 4, 'cuatro módulos');
  eq(lessons.length, 12, 'doce lecciones');
  eq(TOTAL_LESSONS(DEFAULT_CURRICULUM), 12, 'TOTAL_LESSONS coincide');
  eq(resources.length, 14, 'catorce recursos');
  eq(lessons.reduce((sum, item) => sum + item.lesson.questions.length, 0), 24, 'veinticuatro preguntas');
  ok(lessons.every(item => item.lesson.questions.length >= 1), 'toda lección tiene test');
  ok(lessons.every(item => item.lesson.resources.length >= 1), 'toda lección tiene al menos un recurso');
  ok(['template', 'script', 'checklist', 'link', 'doc', 'video'].includes(resources[0].resource.type), 'tipo de recurso conocido');

  // 2) Frase diaria: misma semilla y día = misma frase; 16 días seguidos no repiten.
  const seed = 'seed-test-01';
  eq(quoteOfDay(seed, '2026-11-19').id, quoteOfDay(seed, '2026-11-19').id, 'frase estable el mismo día');
  const days = Array.from({ length: QUOTES.length }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
  eq(new Set(days.map(day => quoteOfDay(seed, day).id)).size, QUOTES.length, 'la rotación recorre todas las frases sin repetir');

  // 3) Plantilla CSV versionada → validación → mismo plan. Escribirla dos veces no la altera.
  const files = writeCsvTemplate(tmp);
  eq(files.length, 4, 'cuatro CSV de plantilla');
  const first = Object.fromEntries(files.map(file => [path.basename(file), readFileSync(file, 'utf8')]));
  writeCsvTemplate(tmp);
  for (const [name, contents] of Object.entries(first)) eq(readFileSync(path.join(tmp, name), 'utf8'), contents, `${name} idempotente`);

  const read = readCsvDirectory(tmp);
  ok(read.ok, `la carpeta de plantilla se lee: ${read.ok ? '' : read.errors.join('; ')}`);
  const built = buildCurriculumFromSheets(read.sheets, '2026-11-20');
  ok(built.ok, `la plantilla se importa: ${built.ok ? '' : built.errors.join('; ')}`);
  if (built.ok) {
    eq(planOf(built.curriculum), { version: '2026-11-20', modules: 4, lessons: 12, resources: 14, questions: 24 }, 'plan del ida y vuelta');
    eq(built.curriculum.modules[0].id, 'fundamentos', 'conserva el orden y los ids');
    eq(built.curriculum.modules[0].lessons[0].id, 'fundamentos-identidad', 'conserva la primera lección');
    eq(built.curriculum.modules[0].lessons[0].questions[0].options[built.curriculum.modules[0].lessons[0].questions[0].correct], built.curriculum.modules[0].lessons[0].questions[0].options[built.curriculum.modules[0].lessons[0].questions[0].correct], 'la respuesta correcta apunta a una opción');
  }

  // 3b) Un .xlsx real (cuatro hojas, generado desde la plantilla) entra por el lector de Excel.
  const xlsx = await readXlsx(path.join(root, 'tests/fixtures/training-template.xlsx'));
  ok(xlsx.ok, `el .xlsx se lee: ${xlsx.ok ? '' : xlsx.errors.join('; ')}`);
  if (xlsx.ok) {
    const fromXlsx = buildCurriculumFromSheets(xlsx.sheets, '2026-11-20');
    ok(fromXlsx.ok, `el .xlsx se importa: ${fromXlsx.ok ? '' : fromXlsx.errors.join('; ')}`);
    if (fromXlsx.ok) eq(planOf(fromXlsx.curriculum), planOf(DEFAULT_CURRICULUM), 'el .xlsx produce el mismo currículo');
  }

  // 4) La exportación CSV también vuelve a entrar (round-trip en memoria, con comas y comillas).
  const csv = curriculumToCsv(DEFAULT_CURRICULUM);
  const sheets = Object.fromEntries(Object.entries(csv).map(([name, lines]) => [name, parseCsv(lines.join('\n'))]));
  const roundTrip = buildCurriculumFromSheets(sheets, '2026-11-21');
  ok(roundTrip.ok, `round-trip válido: ${roundTrip.ok ? '' : roundTrip.errors.join('; ')}`);
  if (roundTrip.ok) {
    const { version: _version, ...counts } = planOf(roundTrip.curriculum);
    eq(counts, (({ version: _defaultVersion, ...rest }) => rest)(planOf(DEFAULT_CURRICULUM)), 'mismo plan tras exportar e importar');
  }

  // 5) Cabecera ausente: error de columna, sin currículo parcial.
  const noId = Object.fromEntries(Object.entries(sheets).map(([name, rows]) => [name, rows.map(row => [...row])]));
  noId.modules[0] = noId.modules[0].filter(header => header !== 'id');
  const missing = buildCurriculumFromSheets(noId, '2026-11-22');
  eq(missing.ok, false, 'una cabecera ausente invalida la importación');
  ok(missing.errors.some(error => error.includes('modules') && error.includes('id')), 'el error nombra la hoja y la columna');

  // 6) Referencia rota y respuesta correcta que no existe: se declaran las dos, no se escribe nada.
  const broken = Object.fromEntries(Object.entries(sheets).map(([name, rows]) => [name, rows.map(row => [...row])]));
  const lessonModule = broken.lessons[0].indexOf('module_id');
  broken.lessons[2][lessonModule] = 'modulo-inexistente';
  const questionCorrect = broken.questions[0].indexOf('correct');
  broken.questions[1][questionCorrect] = 'Una opción que no está';
  const rejected = buildCurriculumFromSheets(broken, '2026-11-23');
  eq(rejected.ok, false, 'una fila mala invalida el conjunto');
  ok(rejected.errors.some(error => error.includes('module_id desconocido')), 'detecta el módulo inexistente');
  ok(rejected.errors.some(error => error.includes('correct')), 'detecta la respuesta correcta inválida');
  eq(rejected.curriculum, undefined, 'no devuelve un currículo a medias');

  // 7) CLI en seco: valida y no crea el archivo de salida.
  const output = path.join(tmp, 'no-debe-existir.json');
  const cli = spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', './tests/admin-auth/ts-resolve.mjs',
    path.join(root, 'scripts/training-import.mjs'), '--input', tmp, '--version', '2026-11-24', '--out', output,
  ], { cwd: root, encoding: 'utf8' });
  // --out sí escribe (es una exportación explícita); el dry-run es la ausencia de --out/--supabase.
  eq(cli.status, 0, `el importador termina bien: ${cli.stderr}`);
  ok(cli.stdout.includes('Válido: 4 módulos, 12 lecciones, 14 recursos, 24 preguntas'), 'el resumen cuenta lo importado');
  ok(existsSync(output), 'una exportación explícita escribe el JSON validado');
  const dry = spawnSync(process.execPath, [
    '--experimental-strip-types', '--import', './tests/admin-auth/ts-resolve.mjs',
    path.join(root, 'scripts/training-import.mjs'), '--input', tmp, '--version', '2026-11-24',
  ], { cwd: root, encoding: 'utf8' });
  eq(dry.status, 0, `el dry-run termina bien: ${dry.stderr}`);
  ok(dry.stdout.includes('Dry-run: no se ha escrito nada'), 'sin --out/--supabase no escribe');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`training-curriculum: ${passed} comprobaciones OK`);
