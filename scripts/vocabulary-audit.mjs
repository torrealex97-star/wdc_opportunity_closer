#!/usr/bin/env node
// Auditoría del vocabulario de clasificación sobre lo YA recogido. Solo lectura.
//
// Reejecuta `classifyRole` del motor sobre los títulos guardados en D1 con el vocabulario actual y
// con el que resultaría de un cambio, y compara lo que de verdad decide la superficie de la alumna:
// títulos, cambios de familia, `null → perfil` (recuperados), `perfil → null` (regresiones) y qué
// fichas ya revisadas cambian de filtro. La única consulta que lanza es un SELECT; no recoge, no escribe
// en D1 y no despliega nada.
//
// Uso:
//   npm run vocab:audit -- --patch cambios.json
//   npm run vocab:audit -- --terms bdr,adr,"business developer"
//   npm run vocab:audit -- --keywords vocabulario-completo.json --refresh
//   npm run vocab:audit -- --patch cambios.json --fail-on-regression   # para CI
//
// cambios.json:  { "add": { "setter": ["adr"] }, "remove": { "closer": ["business developer"] } }
//   · add     añade términos a una familia del motor (sin duplicar)
//   · remove  quita términos exactos de una familia
//
// La instantánea de títulos se guarda en .local/vocab-audit/snapshot.json y se reutiliza 12 h
// (--refresh para traerla de nuevo, --max-age para cambiar la ventana).
// La ventana de cuerpo por defecto es 800 caracteres, la misma que usa el gate de ingesta `familyOf`;
// con --window se puede ampliar (la vista de alumna clasifica con el cuerpo completo).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKER = join(ROOT, 'sites/engine/worker.js');
const SNAPSHOT = join(ROOT, '.local/vocab-audit/snapshot.json');
const REVIEWED = new Set(['approved', 'published']);
const FAMILIES = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'];

// ── utilidades puras (las prueba tests/vocabulary-audit.mjs) ────────────────────────────────
export const fold = text => (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Solo se permite leer. Una consulta que no empiece por SELECT no se ejecuta, aunque alguien la
// escriba en el futuro: este script existe para medir, no para tocar la base.
export function assertSelectOnly(sql) {
  const clean = String(sql ?? '').trim().replace(/^--.*$/gm, '').trim();
  if (!/^select\b/i.test(clean)) throw new Error(`solo SELECT: se rechazó «${clean.slice(0, 40)}…»`);
  if (/;\s*\S/.test(clean)) throw new Error('una sola consulta por ejecución');
  return clean;
}

// El bloque `const ROLE_KEYWORDS = { … }` del motor, como texto y como objeto.
export function readVocabularyBlock(workerText) {
  const start = workerText.indexOf('const ROLE_KEYWORDS = {');
  if (start < 0) throw new Error('no encuentro ROLE_KEYWORDS en el motor');
  const open = workerText.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < workerText.length; i++) {
    if (workerText[i] === '{') depth += 1;
    else if (workerText[i] === '}') {
      depth -= 1;
      if (!depth) return { text: workerText.slice(open, i + 1), start: open, end: i + 1 };
    }
  }
  throw new Error('ROLE_KEYWORDS sin cerrar');
}

export function parseVocabulary(workerText) {
  const { text } = readVocabularyBlock(workerText);
  // El bloque es un literal de objeto válido: se evalúa en el proceso de este script, no en la base.
  return new Function(`return (${text});`)();
}

export function replaceVocabularyBlock(workerText, vocabulary) {
  const { start, end } = readVocabularyBlock(workerText);
  for (const family of Object.keys(vocabulary)) {
    if (!FAMILIES.includes(family)) throw new Error(`familia desconocida en el vocabulario propuesto: ${family}`);
    if (!Array.isArray(vocabulary[family])) throw new Error(`${family} debe ser una lista de términos`);
  }
  // El motor evalúa las cinco familias en orden: si falta una, classifyRole revienta a media pasada
  // y el informe saldría vacío sin decir por qué.
  for (const family of FAMILIES) {
    if (!(family in vocabulary)) throw new Error(`falta la familia ${family} en el vocabulario propuesto`);
  }
  const body = JSON.stringify(vocabulary, null, 2);
  return `${workerText.slice(0, start)}${body}${workerText.slice(end)}`;
}

// Aplica el cambio sin mutar la entrada. Los términos entran sin duplicar y en el orden dado, para
// que el resultado sea el mismo entre ejecuciones (un audit que cambia de orden no es un audit).
export function applyVocabularyPatch(base, patch = {}) {
  const next = Object.fromEntries(Object.entries(base).map(([family, terms]) => [family, [...terms]]));
  for (const [family, terms] of Object.entries(patch.remove ?? {})) {
    if (!FAMILIES.includes(family)) throw new Error(`remove: familia desconocida ${family}`);
    if (!Array.isArray(terms)) throw new Error(`remove.${family} debe ser una lista`);
    next[family] = next[family].filter(term => !terms.includes(term));
  }
  for (const [family, terms] of Object.entries(patch.add ?? {})) {
    if (!FAMILIES.includes(family)) throw new Error(`add: familia desconocida ${family}`);
    if (!Array.isArray(terms)) throw new Error(`add.${family} debe ser una lista`);
    for (const term of terms) {
      if (typeof term !== 'string' || !term.trim()) throw new Error(`add.${family}: término vacío`);
      if (!next[family].includes(term)) next[family].push(term);
    }
  }
  return next;
}

// Compara las dos pasadas. Devuelve cifras, no texto: el informe es solo presentación.
export function summarize(rows, before, after, { terms = [], window = 800, hasWord } = {}) {
  const classify = (engine, row) => engine.classifyRole({ title: row.title }, fold(`${row.title ?? ''} ${row.location ?? ''} ${String(row.body ?? '').slice(0, window)}`));
  const wanted = terms.map(term => fold(term)).filter(Boolean);
  const hits = row => !wanted.length || wanted.some(term => (hasWord ? hasWord(fold(row.title), term) : fold(row.title).includes(term)));

  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = fold(row.title).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  const selected = unique.filter(hits);
  const counts = { titles: unique.length, selected: selected.length, changed: 0, recovered: 0, lost: 0, same: 0 };
  const transitions = new Map();
  const reviewed = { rows: 0, changed: 0, recovered: 0, lost: 0, transitions: new Map() };
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const row of selected) {
    const from = classify(before, row) ?? null;
    const to = classify(after, row) ?? null;
    const isReviewed = REVIEWED.has(row.status);
    if (isReviewed) reviewed.rows += 1;
    if (from === to) { counts.same += 1; continue; }
    counts.changed += 1;
    bump(transitions, `${from ?? 'null'} → ${to ?? 'null'}`);
    if (!from && to) counts.recovered += 1;
    if (from && !to) counts.lost += 1;
    if (isReviewed) {
      reviewed.changed += 1;
      bump(reviewed.transitions, `${from ?? 'null'} → ${to ?? 'null'}`);
      if (!from && to) reviewed.recovered += 1;
      if (from && !to) reviewed.lost += 1;
    }
  }
  return {
    ...counts,
    transitions: Object.fromEntries([...transitions.entries()].sort((a, b) => b[1] - a[1])),
    reviewed: { ...reviewed, transitions: Object.fromEntries([...reviewed.transitions.entries()].sort((a, b) => b[1] - a[1])) },
  };
}

// Monta un motor con el vocabulario propuesto, sin tocar el archivo del repo: copia a un temporal y
// se importa como módulo, que es la misma vía que usan los tests del motor.
export async function buildCandidateEngine(vocabulary) {
  const source = readFileSync(WORKER, 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'wdc-vocab-audit-'));
  const staging = join(dir, 'worker.mjs');
  writeFileSync(staging, replaceVocabularyBlock(source, vocabulary));
  return (await import(pathToFileURL(staging).href)).__test;
}

export async function currentEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'wdc-vocab-audit-base-'));
  const staging = join(dir, 'worker.mjs');
  copyFileSync(WORKER, staging);
  return (await import(pathToFileURL(staging).href)).__test;
}

// ── D1 (solo lectura) ──────────────────────────────────────────────────────────────────────
function accountId() {
  const env = readFileSync(join(ROOT, '.local/cloudflare-cut/account.env'), 'utf8');
  const line = env.split(/\r?\n/).find(row => row.startsWith('CF_ACCOUNT_ID='));
  if (!line) throw new Error('falta CF_ACCOUNT_ID en .local/cloudflare-cut/account.env');
  return line.split('=')[1].trim();
}

const BODY = `substr(coalesce(json_extract(payload,'$.raw.description'), json_extract(payload,'$.raw.attributes.description'), json_extract(payload,'$.description'), json_extract(payload,'$.raw.excerpt'), ''),1,4000)`;

const QUERIES = {
  collected: `SELECT json_extract(payload,'$.title') AS title, json_extract(payload,'$.location') AS location, ${BODY} AS body, source
    FROM raw_items WHERE payload IS NOT NULL AND json_extract(payload,'$.title') IS NOT NULL`,
  catalog: `SELECT json_extract(p.payload,'$.title') AS title, json_extract(p.payload,'$.location') AS location,
      substr(coalesce(json_extract(p.payload,'$.raw.description'), json_extract(p.payload,'$.raw.attributes.description'), json_extract(p.payload,'$.description'), ''),1,4000) AS body,
      p.source AS source, o.editorial_status AS status
    FROM catalog_entries c
    JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
    JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    LEFT JOIN opportunities o ON o.org_id=c.org_id AND o.job_id=c.job_id`,
};

export function query(sql) {
  const out = execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'closer-engine', '--remote', '--config', 'wrangler.toml', '--json', '--command', assertSelectOnly(sql)], {
    cwd: join(ROOT, 'sites/engine'),
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId() },
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  return parsed[0].results;
}

export function exportSnapshot() {
  const snapshot = { exportedAt: new Date().toISOString(), collected: query(QUERIES.collected), catalog: query(QUERIES.catalog) };
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot));
  return snapshot;
}

export function loadSnapshot({ refresh = false, maxAgeHours = 12 } = {}) {
  if (!refresh && existsSync(SNAPSHOT)) {
    const ageHours = (Date.now() - statSync(SNAPSHOT).mtimeMs) / 3600000;
    if (ageHours <= maxAgeHours) return { snapshot: JSON.parse(readFileSync(SNAPSHOT, 'utf8')), cached: true };
  }
  return { snapshot: exportSnapshot(), cached: false };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { terms: [], window: 800, refresh: false, maxAgeHours: 12, json: false, failOnRegression: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--patch') args.patch = argv[++i];
    else if (arg === '--keywords') args.keywords = argv[++i];
    else if (arg === '--terms') args.terms = String(argv[++i] ?? '').split(',').map(t => t.trim()).filter(Boolean);
    else if (arg === '--window') args.window = Number(argv[++i]);
    else if (arg === '--snapshot') args.snapshot = argv[++i];
    else if (arg === '--refresh') args.refresh = true;
    else if (arg === '--max-age') args.maxAgeHours = Number(argv[++i]);
    else if (arg === '--json') args.json = true;
    else if (arg === '--fail-on-regression') args.failOnRegression = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`opción desconocida: ${arg}`);
  }
  return args;
}

const pct = (part, total) => total ? `${((part / total) * 100).toFixed(1)} %` : '—';
const pad = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).join('\n'));
    return 0;
  }
  if (!args.patch && !args.keywords) throw new Error('indica el cambio: --patch cambios.json o --keywords vocabulario.json');

  const base = await currentEngine();
  const before = parseVocabulary(readFileSync(WORKER, 'utf8'));
  const after = args.keywords ? JSON.parse(readFileSync(args.keywords, 'utf8')) : applyVocabularyPatch(before, JSON.parse(readFileSync(args.patch, 'utf8')));
  const candidate = await buildCandidateEngine(after);

  const { snapshot, cached } = loadSnapshot({ refresh: args.refresh, maxAgeHours: args.maxAgeHours });
  const changed = Object.keys(after).filter(family => JSON.stringify(before[family]) !== JSON.stringify(after[family]))
    .map(family => {
      const added = after[family].filter(term => !before[family].includes(term));
      const removed = before[family].filter(term => !after[family].includes(term));
      return `${family}: ${added.length ? `+${added.join(', +')}` : ''}${added.length && removed.length ? ' · ' : ''}${removed.length ? `−${removed.join(', −')}` : ''}`;
    });

  const report = { snapshotAt: snapshot.exportedAt, cached, window: args.window, terms: args.terms, change: changed, universes: {} };
  for (const [name, rows] of [['collected', snapshot.collected], ['catalog', snapshot.catalog]]) {
    report.universes[name] = { rows: rows.length, ...summarize(rows, base, candidate, { terms: args.terms, window: args.window, hasWord: base.hasWord }) };
  }

  if (args.json) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`Instantánea ${cached ? 'reutilizada' : 'recién exportada'} de ${snapshot.exportedAt} · ventana ${args.window} caracteres`);
    console.log(`Cambio propuesto: ${changed.length ? changed.join(' | ') : 'ninguno (el vocabulario es idéntico)'}`);
    if (args.terms.length) console.log(`Filtrado a títulos con: ${args.terms.join(', ')}`);
    for (const [name, label] of [['collected', 'RECOGIDO (raw_items)'], ['catalog', 'CATÁLOGO (catalog_entries)']]) {
      const r = report.universes[name];
      console.log(`\n== ${label} ==`);
      console.log(`filas ${pad(r.rows)} · títulos únicos ${pad(r.titles)}${args.terms.length ? ` · con los términos ${pad(r.selected)}` : ''}`);
      console.log(`cambian de familia ${pad(r.changed)} (${pct(r.changed, r.selected)}) · igual ${pad(r.same)}`);
      for (const [transition, count] of Object.entries(r.transitions)) console.log(`  ${String(count).padStart(5)}  ${transition}`);
      console.log(`recuperados (null → perfil): ${pad(r.recovered)} · regresiones (perfil → null): ${pad(r.lost)}`);
      if (name === 'catalog') {
        const rv = r.reviewed;
        console.log(`revisadas (approved/published): ${pad(rv.rows)} fichas · cambian de filtro ${pad(rv.changed)}`);
        for (const [transition, count] of Object.entries(rv.transitions)) console.log(`  ${String(count).padStart(5)}  ${transition}`);
      }
    }
  }
  // Una regresión —una ficha que hoy tiene familia y con el cambio se quedaría sin ella— es un fallo,
  // no un dato: si se pide, el proceso sale en rojo para que CI lo vea.
  const regressions = report.universes.catalog.lost + report.universes.collected.lost;
  if (args.failOnRegression && regressions) {
    console.error(`\n${regressions} regresión(es): títulos que perderían su familia.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main().catch(error => { console.error(`Error: ${error.message}`); return 2; });
}
