#!/usr/bin/env node
// Genera `apps/web/lib/classroomMap.ts` desde el mapa del Classroom que vive en la skill
// (`metodo-wdc` §0.2 módulos y §0.3 buscador de temas). Es la única fuente: si el Classroom cambia,
// se edita la skill y se regenera; el portal nunca inventa un módulo ni una lección.
//
//   node scripts/classroom-map.mjs           # escribe el módulo
//   node scripts/classroom-map.mjs --check   # falla si el fichero no coincide con la skill
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILL = path.join(ROOT, '.agents/skills/metodo-wdc/SKILL.md');
const OUT = path.join(ROOT, 'apps/web/lib/classroomMap.ts');

const clean = (value) => String(value ?? '').trim();
const tableRows = (markdown, headerFirstCell) => {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('|') && clean(line.split('|')[1]).toLowerCase() === headerFirstCell.toLowerCase());
  if (start < 0) throw new Error(`No se encontró la tabla «${headerFirstCell}» en la skill.`);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map(clean));
  }
  return rows;
};

/** Códigos de lección de una celda del mapa: sueltos, con «y» o en rango (12.29–12.35). */
export function lessonCodes(cell) {
  const codes = [];
  const text = String(cell ?? '');
  const ranges = [...text.matchAll(/(\d{1,2}\.\d{1,2})\s*[–-]\s*(\d{1,2}\.\d{1,2})/g)];
  for (const [, from, to] of ranges) {
    const [course, first] = from.split('.').map(Number);
    const last = Number(to.split('.')[1]);
    for (let n = first; n <= last; n += 1) codes.push(`${course}.${n}`);
  }
  const withoutRanges = text.replace(/(\d{1,2}\.\d{1,2})\s*[–-]\s*(\d{1,2}\.\d{1,2})/g, ' ');
  for (const match of withoutRanges.matchAll(/\b(\d{1,2}\.\d{1,2})\b/g)) codes.push(match[1]);
  return [...new Set(codes)];
}

export function parseMap(markdown) {
  const modules = tableRows(markdown, '#')
    .filter(([order]) => /^\d+$/.test(order))
    .map(([order, name, lessons, duration, resources, teaches, section]) => ({
      order: Number(order), name, lessons: Number(lessons), duration, resources, teaches, section,
    }));
  const topics = tableRows(markdown, 'Si preguntan por…')
    .filter(([topic]) => topic && topic !== '—')
    .map(([topic, teaches, section]) => ({ topic, lessons: lessonCodes(teaches), teaches, section }));
  return { modules, topics };
}

const js = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function render({ modules, topics }) {
  const lines = [
    '// Mapa del Classroom de Women Digital Closers, tal como lo declara la skill `metodo-wdc` (§0.2 y §0.3):',
    '// los 12 módulos y el buscador de temas que dice en qué lección se enseña cada cosa.',
    '// Generado desde `.agents/skills/metodo-wdc/SKILL.md` con `scripts/classroom-map.mjs`: no se edita a mano.',
    '// Aquí no hay contenido de las clases, solo su índice: el vídeo y los materiales viven en Skool.',
    '',
    'export type ClassroomModule = {',
    '  order: number;',
    '  name: string;',
    '  lessons: number;',
    '  duration: string;',
    '  /** Cuántos recursos enlaza el Classroom en ese módulo («—» si solo son vídeos). */',
    '  resources: string;',
    '  /** Qué se enseña, en una línea, tal como lo resume la skill. */',
    '  teaches: string;',
    '  /** Sección de la skill donde está escrito el método. */',
    '  section: string;',
    '};',
    '',
    'export type ClassroomTopic = {',
    '  topic: string;',
    '  /** Lecciones del Classroom (`7.5`) donde se enseña, en el orden del mapa. */',
    '  lessons: string[];',
    '  /** Columna «Se enseña en» del mapa, con el nombre de la clase cuando la skill lo da. */',
    '  teaches: string;',
    '  section: string;',
    '};',
    '',
    'export const CLASSROOM_MODULES: ClassroomModule[] = [',
    ...modules.map((m) => `  { order: ${m.order}, name: ${js(m.name)}, lessons: ${m.lessons}, duration: ${js(m.duration)}, resources: ${js(m.resources)}, teaches: ${js(m.teaches)}, section: ${js(m.section)} },`),
    '];',
    '',
    'export const CLASSROOM_TOPICS: ClassroomTopic[] = [',
    ...topics.map((t) => `  { topic: ${js(t.topic)}, lessons: [${t.lessons.map(js).join(', ')}], teaches: ${js(t.teaches)}, section: ${js(t.section)} },`),
    '];',
    '',
    'export const CLASSROOM_TOTALS = {',
    `  modules: ${modules.length},`,
    `  lessons: ${modules.reduce((sum, m) => sum + m.lessons, 0)},`,
    `  topics: ${topics.length},`,
    '};',
    '',
  ];
  return lines.join('\n');
}

const markdown = readFileSync(SKILL, 'utf8');
const map = parseMap(markdown);
if (map.modules.length !== 12) throw new Error(`La skill declara ${map.modules.length} módulos: se esperaban 12.`);
const generated = render(map);
if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== generated) {
    console.error('classroomMap.ts no coincide con la skill: ejecuta `node scripts/classroom-map.mjs`.');
    process.exit(1);
  }
  console.log(`classroomMap.ts al día (${map.topics.length} temas).`);
  process.exit(0);
}
writeFileSync(OUT, generated, 'utf8');
console.log(`${map.modules.length} módulos, ${map.modules.reduce((sum, m) => sum + m.lessons, 0)} lecciones y ${map.topics.length} temas → apps/web/lib/classroomMap.ts`);
