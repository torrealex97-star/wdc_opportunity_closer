#!/usr/bin/env node
// Genera apps/web/lib/wdcKnowledge.ts desde la skill `metodo-wdc`.
//
// La fuente de verdad es el SKILL.md de la academia (`.agents/skills/metodo-wdc/SKILL.md`): aquí solo
// se corta en trozos buscables, sin reescribir ni resumir una línea. El asistente de la alumna
// (`lib/academyAssistant.ts`) recupera trozos de este índice y cita el `§` y la lección de donde sale;
// si algo no está, lo dice en vez de inventarlo.
//
// Uso: node scripts/wdc-knowledge.mjs [--check]
//   --check  falla si el fichero generado no coincide con la skill (para CI).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const skillPath = path.join(root, '.agents/skills/metodo-wdc/SKILL.md');
const outPath = path.join(root, 'apps/web/lib/wdcKnowledge.ts');

const SLUG = /[^a-z0-9]+/g;
const slug = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(SLUG, '-').replace(/^-|-$/g, '').slice(0, 80);

/**
 * Tope de un trozo. Por encima de esto, el trozo se parte por párrafos: un bloque de 8.000 caracteres
 * con las diez objeciones dentro diluye la palabra que busca la alumna y el acierto cae.
 */
const MAX_CHUNK = 1600;

/** Parte un texto largo por párrafos (sin cortar tablas: repite su cabecera en cada parte). */
function splitText(text, max = MAX_CHUNK) {
  const blocks = text.split(/\n\n+/).map((block) => block.trim()).filter(Boolean);
  const header = blocks.find((block) => block.startsWith('|'))?.split('\n').slice(0, 2).join('\n') ?? null;
  const parts = [];
  let current = [];
  let size = 0;
  const push = () => {
    if (!current.length) return;
    const body = current.join('\n\n');
    // Una parte que empieza a media tabla necesita la cabecera para que se entienda.
    const needsHeader = header && body.includes('\n|') && !body.startsWith(header.split('\n')[0]);
    parts.push(needsHeader ? `${header}\n${body}` : body);
    current = [];
    size = 0;
  };
  for (const block of blocks) {
    if (block.length > max) {
      push();
      const lines = block.split('\n');
      let chunk = [];
      let length = 0;
      for (const line of lines) {
        if (length + line.length > max && chunk.length) { parts.push(chunk.join('\n')); chunk = []; length = 0; }
        chunk.push(line);
        length += line.length + 1;
      }
      if (chunk.length) parts.push(chunk.join('\n'));
      continue;
    }
    if (size + block.length > max) push();
    current.push(block);
    size += block.length + 2;
  }
  push();
  return parts.length ? parts : [text];
}

/** Corta el SKILL.md en trozos: cada `##` es un tema y cada `###`/`####` una pieza dentro de él. */
export function chunkSkill(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let section = 'Introducción';
  let subsection = null;
  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length < 40) return;
    const title = subsection ?? section;
    const base = `${slug(section)}${subsection ? `--${slug(subsection)}` : ''}`;
    // Cada parte conserva el encabezado del trozo: sin él, «9. Cualificación» desaparece de la mitad
    // de los trozos y la pregunta por la cualificación ya no encuentra su sección.
    const heading = buffer[0]?.startsWith('#') ? buffer[0].trim() : null;
    const withHeading = (text.length > MAX_CHUNK ? splitText(text) : [text])
      .map((part) => heading && !part.startsWith(heading) ? `${heading}\n\n${part}` : part);
    // Una parte de dos líneas no es un trozo: se pega a la anterior (o a la siguiente si abre la
    // sección) para no dejar migas de 30 caracteres sin contenido que citar.
    const bodyOf = (part) => (heading ? part.replace(heading, '').trim() : part.trim());
    const parts = [];
    let pending = '';
    for (const part of withHeading) {
      const joined = pending ? `${pending}\n\n${part}` : part;
      if (bodyOf(joined).length < 60) { pending = joined; continue; }
      parts.push(joined);
      pending = '';
    }
    if (pending) {
      if (parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]}\n\n${pending}`;
      else parts.push(pending);
    }
    parts.forEach((part, index) => {
      chunks.push({
        id: parts.length > 1 ? `${base}--p${index + 1}` : base,
        part: parts.length > 1 ? index + 1 : null,
        section,
        subsection,
        title: parts.length > 1 ? `${title} (parte ${index + 1})` : title,
        text: part,
        // La lección del Classroom citada dentro del trozo (`Fuente: 6.1`, `(7.3)`): se conserva para
        // que la respuesta pueda decir «módulo 7, lección 3» sin que el modelo lo adivine.
        lessons: [...new Set([...part.matchAll(/\b(\d{1,2}\.\d{1,2})\b/g)].map((match) => match[1]))].slice(0, 12),
      });
    });
    buffer = [];
  };
  for (const line of lines) {
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);
    const h4 = line.match(/^#### (.+)$/);
    if (h2) { flush(); section = h2[1].trim(); subsection = null; buffer.push(`# ${section}`); continue; }
    if (h3 || h4) { flush(); subsection = (h3 ?? h4)[1].trim(); buffer.push(`## ${subsection}`); continue; }
    if (line.startsWith('---')) continue;
    buffer.push(line);
  }
  flush();
  return chunks;
}

const markdown = readFileSync(skillPath, 'utf8');
const chunks = chunkSkill(markdown);
if (chunks.length < 60) {
  console.error(`Solo ${chunks.length} trozos: ¿el SKILL.md cambió de formato?`);
  process.exit(1);
}

const header = `// GENERADO desde .agents/skills/metodo-wdc/SKILL.md — no editar a mano.
// Regenerar: node scripts/wdc-knowledge.mjs
//
// Es la skill de la academia cortada en trozos buscables: texto íntegro, sin resumir. El asistente
// (\`lib/academyAssistant.ts\`) recupera los trozos que hablan de la pregunta y los cita; nunca
// responde con algo que no esté aquí.
export type KnowledgeChunk = {
  id: string;
  /** Sección \`## N.\` de la skill (por ejemplo «7. Psicología de compra»). */
  section: string;
  /** Subsección \`###\`/\`####\` si el trozo está dentro de una. */
  subsection: string | null;
  /** Título corto con el que se cita el trozo. */
  title: string;
  /** Texto íntegro del trozo (markdown). */
  text: string;
  /** Lecciones del Classroom citadas dentro del trozo (\`módulo.lección\`). */
  lessons: string[];
  /** Número de parte si el trozo original era largo y se partió; \`null\` si está entero. */
  part: number | null;
};

export const WDC_SKILL_VERSION = ${JSON.stringify(markdown.length)};

export const WDC_KNOWLEDGE: KnowledgeChunk[] = [
`;
const body = chunks.map((chunk) => `  ${JSON.stringify(chunk)},`).join('\n');
const footer = '\n];\n';
const output = `${header}${body}${footer}`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(outPath, 'utf8'); } catch { current = ''; }
  if (current !== output) {
    console.error('apps/web/lib/wdcKnowledge.ts no coincide con la skill. Ejecuta: node scripts/wdc-knowledge.mjs');
    process.exit(1);
  }
  console.log(`wdcKnowledge.ts al día (${chunks.length} trozos).`);
} else {
  writeFileSync(outPath, output);
  console.log(`wdcKnowledge.ts escrito: ${chunks.length} trozos, ${(output.length / 1024).toFixed(0)} KB.`);
}
