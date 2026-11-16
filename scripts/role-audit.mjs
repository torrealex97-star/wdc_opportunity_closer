#!/usr/bin/env node
// ¿De dónde saldrían más ofertas de SDR y de Cold Caller? Mide sobre lo YA recogido. Solo lectura.
//
// El hueco ampliado se abre sobre todo con sdr (18/40 combinaciones) y cold_caller (14/40), y las dos
// son las familias con menos inventario. Antes de añadir una fuente o un término, este script
// responde con números de lo que ya hay en D1:
//
//   1. qué fuente aporta hoy cada anuncio de sdr / cold_caller (y cuántos títulos únicos son),
//   2. qué anuncios ya recogidos mencionan el puesto en el título pero caen en otra familia o en
//      ninguna — eso mide el vocabulario, no la fuente,
//   3. qué pasaría si se añadiera cada término candidato, término a término, con el vocabulario de
//      verdad (`classifyRole`) y contando de qué fuente saldrían las tarjetas recuperadas,
//   4. el escenario completo: todos los términos recomendados de golpe.
//
// Comparte la instantánea de `vocabulary-audit.mjs` (.local/vocab-audit/snapshot.json) y, como
// aquel, la única consulta que lanza es un SELECT: no recoge, no escribe y no despliega.
//
// Uso:
//   npm run role:audit
//   npm run role:audit -- --refresh --json
//   npm run role:audit -- --window 4000 --max-age 0
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applyVocabularyPatch, buildCandidateEngine, currentEngine, fold, loadSnapshot, parseVocabulary } from './vocabulary-audit.mjs';

const WORKER = new URL('../sites/engine/worker.js', import.meta.url);

const WINDOW = 800; // los mismos 800 caracteres que usa familyOf en la ingesta

// Términos que hoy NO están en ROLE_KEYWORDS y que el mercado español usa para el mismo puesto.
// «bdr» y «business development representative» se quedan fuera de sdr a propósito: el ADR los
// colocó en setter por orden de evaluación (setter se evalúa antes) y aquí no se propone moverlos.
export const SDR_TERMS = [
  'representante de desarrollo de ventas', 'representante de desarrollo comercial',
  'sales development rep', 'sdr bilingue', 'sdr/bdr', 'prospecting',
  'prospeccion de ventas', 'prospector de ventas', 'desarrollo de negocio',
  'desarrollador de negocio', 'desarrolladora de negocio', 'business developer',
  'lead development representative', 'demand generation', 'preventa', 'preventas',
  'preventista', 'tecnico de preventa', 'especialista de preventa', 'hunter',
];

export const COLD_TERMS = [
  'cold call', 'llamadas frias', 'llamada en frio', 'llamadas de venta',
  'teleoperador/a telefonico', 'operador de call center', 'agente de call center',
  'call center', 'contact center', 'telesales', 'televenta telefonica',
  'prospeccion comercial', 'comercial de prospeccion', 'captador telefonico',
  'operador comercial', 'telefonista comercial', 'telemarketing telefonico',
];

export const CANDIDATES = [
  ...SDR_TERMS.map(term => ({ term, family: 'sdr' })),
  ...COLD_TERMS.map(term => ({ term, family: 'cold_caller' })),
];

const TARGETS = new Set(['sdr', 'cold_caller']);

// Rol de una fila con el vocabulario real del motor: título + ubicación + primeros N del cuerpo.
export const roleOf = (engine, row, window = WINDOW) =>
  engine.classifyRole({ title: row.title }, fold(`${row.title ?? ''} ${row.location ?? ''} ${String(row.body ?? '').slice(0, window)}`)) ?? null;

// ¿La tarjeta llegaría a la vista de alumna? Mismos gates que la ingesta y la vista (ES, castellano),
// con una URL de relleno que solo vive en memoria para que «sin enlace» no cuente como elegible.
const PLACEHOLDER_URL = 'https://role-audit.invalid/anuncio';
const eligibleIn = (engine, row) => {
  const payload = { title: row.title, location: row.location, url: PLACEHOLDER_URL, raw: { description: row.body ?? '' } };
  if (engine.discardReason(payload)) return { es: false, any: false };
  const spanish = engine.spanishBodyGate(engine.descriptionOf(payload), false).ok;
  return { any: spanish, es: spanish && !engine.marketRejects(payload, 'ES') };
};

const uniqueTitles = rows => {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = fold(row.title).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

const sourceTable = (rows, engine) => {
  const table = new Map();
  for (const raw of rows) {
    const row = { ...raw, eligible: eligibleIn(engine, raw) };
    const key = row.source ?? '(sin fuente)';
    const entry = table.get(key) ?? { source: key, rows: 0, sdr: 0, cold: 0, sdrES: 0, coldES: 0, closer: 0, setter: 0, ae: 0, none: 0, titles: new Set() };
    entry.rows += 1;
    entry.titles.add(fold(row.title).trim());
    const role = roleOf(engine, row);
    const inES = row.eligible.es;
    if (role === 'sdr') { entry.sdr += 1; if (inES) entry.sdrES += 1; }
    else if (role === 'cold_caller') { entry.cold += 1; if (inES) entry.coldES += 1; }
    else if (role === 'closer') entry.closer += 1;
    else if (role === 'setter') entry.setter += 1;
    else if (role === 'account_executive') entry.ae += 1;
    else entry.none += 1;
    table.set(key, entry);
  }
  return [...table.values()]
    .map(entry => ({ ...entry, titles: entry.titles.size, target: entry.sdr + entry.cold }))
    .sort((a, b) => b.target - a.target || b.rows - a.rows);
};

// Un término, un motor con ese término añadido: cuántos anuncios cambian de familia y de dónde salen.
const measureTerm = async (before, baseVocabulary, rows, { term, family }) => {
  const folded = fold(term);
  const matched = rows.filter(row => before.hasWord(fold(row.title), folded));
  const eligible = matched.filter(row => row.eligible.es).length;
  if (!matched.length) return { term, family, matched: 0, eligible: 0, already: 0, becomes: 0, becomesES: 0, lost: 0, transitions: {}, sources: {} };
  const after = await buildCandidateEngine(applyVocabularyPatch(baseVocabulary, { add: { [family]: [term] } }));
  let already = 0; let becomes = 0; let becomesES = 0; let lost = 0;
  const transitions = {};
  const sources = {};
  for (const row of matched) {
    const from = roleOf(before, row);
    const to = roleOf(after, row);
    const bump = (map, key) => { map[key] = (map[key] ?? 0) + 1; };
    if (from === to) { if (TARGETS.has(to)) already += 1; continue; }
    bump(transitions, `${from ?? 'sin familia'} → ${to ?? 'sin familia'}`);
    if (TARGETS.has(to) && !TARGETS.has(from)) { becomes += 1; if (row.eligible.es) becomesES += 1; bump(sources, row.source ?? '(sin fuente)'); }
    if (TARGETS.has(from) && !TARGETS.has(to)) lost += 1;
  }
  return { term, family, matched: matched.length, eligible, already, becomes, becomesES, lost, transitions, sources };
};

const pad = (text, size) => String(text).padEnd(size);
const num = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const refresh = args.includes('--refresh');
  const ageIndex = args.indexOf('--max-age');
  const maxAgeHours = ageIndex >= 0 ? Number(args[ageIndex + 1]) : 12;
  const engine = await currentEngine();
  const baseVocabulary = parseVocabulary(readFileSync(WORKER, 'utf8'));
  const { snapshot, cached } = loadSnapshot({ refresh, maxAgeHours });
  const rows = snapshot.collected ?? [];

  if (!rows.length) throw new Error('la instantánea no trae anuncios recogidos');
  const sources = sourceTable(rows, engine);
  const pool = uniqueTitles(rows).map(row => ({ ...row, eligible: eligibleIn(engine, row) }));
  const terms = [];
  for (const candidate of CANDIDATES) terms.push(await measureTerm(engine, baseVocabulary, pool, candidate));
  const winners = terms.filter(t => t.becomes > 0).sort((a, b) => b.becomes - a.becomes);
  const patch = { add: { sdr: SDR_TERMS, cold_caller: COLD_TERMS } };
  const after = await buildCandidateEngine(applyVocabularyPatch(baseVocabulary, patch));
  const combined = { sdr: 0, cold_caller: 0, opened: 0, openedES: 0, sources: {} };
  for (const row of uniqueTitles(rows).map(row => ({ ...row, eligible: eligibleIn(engine, row) }))) {
    const from = roleOf(engine, row);
    const to = roleOf(after, row);
    if (TARGETS.has(to) && from !== to) {
      combined[to] += 1;
      combined.opened += 1;
      if (row.eligible.es) combined.openedES += 1;
      const source = row.source ?? '(sin fuente)';
      combined.sources[source] = (combined.sources[source] ?? 0) + 1;
    }
  }

  const report = {
    snapshotAt: snapshot.exportedAt,
    cached,
    window: WINDOW,
    rows: rows.length,
    titles: uniqueTitles(rows).length,
    sources,
    terms: terms.sort((a, b) => b.becomes - a.becomes),
    combined,
  };

  if (json) { console.log(JSON.stringify(report, null, 2)); return 0; }

  console.log(`Instantánea ${cached ? 'reutilizada' : 'recién exportada'} de ${snapshot.exportedAt} · ventana ${WINDOW} caracteres`);
  console.log(`${num(rows.length)} anuncios recogidos · ${num(report.titles)} títulos únicos`);

  console.log('\n== QUIÉN TRAE HOY SDR Y COLD CALLER ==');
  console.log(`${pad('fuente', 34)}${pad('anuncios', 10)}${pad('títulos', 9)}${pad('sdr', 6)}${pad('cold', 6)}${pad('sdr ES', 7)}${pad('cold ES', 8)}${pad('closer', 8)}${pad('setter', 8)}${pad('AE', 6)}sin familia`);
  for (const row of sources) {
    console.log(`${pad(row.source, 34)}${pad(num(row.rows), 10)}${pad(num(row.titles), 9)}${pad(num(row.sdr), 6)}${pad(num(row.cold), 6)}${pad(num(row.sdrES), 7)}${pad(num(row.coldES), 8)}${pad(num(row.closer), 8)}${pad(num(row.setter), 8)}${pad(num(row.ae), 6)}${num(row.none)}`);
  }
  const targetRows = sources.reduce((n, row) => n + row.target, 0);
  const targetES = sources.reduce((n, row) => n + row.sdrES + row.coldES, 0);
  console.log(`\nsdr + cold_caller hoy: ${num(targetRows)} anuncios de ${num(rows.length)} (${((targetRows / rows.length) * 100).toFixed(1)} %) · elegibles en España: ${num(targetES)}`);

  console.log('\n== TÉRMINOS CANDIDATOS (cuántos anuncios YA recogidos pasan a sdr / cold_caller) ==');
  console.log(`${pad('término', 38)}${pad('familia', 13)}${pad('títulos', 9)}${pad('eligs ES', 10)}${pad('ya era', 8)}${pad('pasan ES', 10)}${pad('pasan', 7)}${pad('pierden', 9)}de dónde salen`);
  for (const term of terms) {
    const from = Object.entries(term.sources).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([source, n]) => `${source} ${n}`).join(', ');
    console.log(`${pad(term.term, 38)}${pad(term.family, 13)}${pad(num(term.matched), 10)}${pad(num(term.eligible), 10)}${pad(num(term.already), 8)}${pad(num(term.becomesES), 10)}${pad(num(term.becomes), 7)}${pad(num(term.lost), 9)}${from || '—'}`);
  }

  console.log('\n== SI SE AÑADIERAN TODOS LOS CANDIDATOS ==');
  console.log(`títulos únicos que cambian de familia: ${num(combined.opened)} (sdr +${num(combined.sdr)}, cold_caller +${num(combined.cold_caller)}) · de esos, elegibles en España: ${num(combined.openedES)}`);
  const perSource = Object.entries(combined.sources).sort((a, b) => b[1] - a[1]);
  if (perSource.length) console.log(`de dónde salen: ${perSource.map(([source, n]) => `${source} ${n}`).join(' · ')}`);
  if (winners.length) {
    console.log(`términos con efecto: ${winners.length} de ${terms.length} (los demás coinciden con 0 anuncios o ya estaban clasificados)`);
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main().catch(error => { console.error(`Error: ${error.message}`); return 2; });
}
