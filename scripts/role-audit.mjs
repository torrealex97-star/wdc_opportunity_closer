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

// ── ¿La tarjeta llega a la alumna? Se le pregunta a la vista, no al gate de ingesta ─────────────
//
// Antes esto miraba `discardReason`, que es el gate de INGESTA: corre con el perfil de la pasada
// (casi siempre closer) y marca `familia_extra` a todo lo demás. Con esa vara, un account executive
// real salía como «no elegible» y el informe llegó a decir que en España no hay ni uno — falso: la
// vista los enseña en cuanto se elige ese perfil, y el hueco ampliado los usa a diario.
//
// Ahora se mide con `studentSurface`, el mismo código que sirve /v1/opportunities/search: mismo
// clasificador, mismo gate de idioma, mismo criterio de mercado, mismo dedupe y la misma regla de
// roles extra. Sin D1: se le pasa un shim con las filas de la instantánea.
//
// Dos diferencias conocidas con la vista real, dichas aquí y no escondidas: la instantánea no trae
// `posted_at`, así que la ventana de días no se aplica (no se finge aplicándola), y la URL se deriva
// del título plegado para que el dedupe por URL colapse el mismo anuncio replicado entre fuentes.
export function shimFor(rows, { nowMs = Date.now() } = {}) {
  const results = rows.map((row, index) => ({
    job_id: `snapshot-${index}`,
    starred: 0,
    source: row.source ?? null,
    expires_at: new Date(nowMs + 86400000).toISOString(),
    payload: JSON.stringify({
      title: row.title,
      location: row.location ?? null,
      url: row.title ? `https://snapshot.invalid/${encodeURIComponent(fold(row.title).trim())}` : null,
      raw: { description: row.body ?? '' },
    }),
  }));
  return { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results }) }) }) } };
}

// Las tarjetas que deja ver esa vista. `includeExtraRoles: true` a propósito: AE y SDR son roles
// extra (solo salen al elegir su perfil) y son justo las familias que este informe mide.
export async function viewOf(engine, rows, { market = 'ES', days = 10, includeBilingual = false } = {}) {
  const { ranked } = await engine.studentSurface(shimFor(rows), {
    role: null, market, days, includeBilingual, starredOnly: false, includeExtraRoles: true,
  });
  return { cards: ranked, titles: new Set(ranked.map(card => fold(card.original_title).trim())) };
}

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

// Cruza lo recogido por fuente (`rows`) con lo que la vista de España deja ver (`view.cards`).
// `visibles` son tarjetas únicas con el dedupe de la vista; `anuncios` es el bruto recogido.
const sourceTable = (rows, view) => {
  const table = new Map();
  const entryFor = key => {
    if (!table.has(key)) table.set(key, { source: key, rows: 0, titles: new Set(), visibles: 0, sdr: 0, cold: 0, closer: 0, setter: 0, ae: 0 });
    return table.get(key);
  };
  for (const row of rows) {
    const entry = entryFor(row.source ?? '(sin fuente)');
    entry.rows += 1;
    entry.titles.add(fold(row.title).trim());
  }
  for (const card of view.cards) {
    const entry = entryFor(card.source_code ?? '(sin fuente)');
    entry.visibles += 1;
    if (card.role === 'sdr') entry.sdr += 1;
    else if (card.role === 'cold_caller') entry.cold += 1;
    else if (card.role === 'closer') entry.closer += 1;
    else if (card.role === 'setter') entry.setter += 1;
    else if (card.role === 'account_executive') entry.ae += 1;
  }
  return [...table.values()]
    .map(entry => ({ ...entry, titles: entry.titles.size, target: entry.sdr + entry.cold }))
    .sort((a, b) => b.target - a.target || b.visibles - a.visibles || b.rows - a.rows);
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

const roleCounts = cards => {
  const counts = {};
  for (const card of cards) counts[card.role ?? 'sin familia'] = (counts[card.role ?? 'sin familia'] ?? 0) + 1;
  return counts;
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
  // La vista, con su código: España y «cualquier mercado». De aquí sale qué tarjeta ve la alumna.
  const esView = await viewOf(engine, rows, { market: 'ES' });
  const anyView = await viewOf(engine, rows, { market: 'any' });
  const sources = sourceTable(rows, esView);
  const pool = uniqueTitles(rows).map(row => {
    const key = fold(row.title).trim();
    return { ...row, eligible: { es: esView.titles.has(key), any: anyView.titles.has(key) } };
  });
  const terms = [];
  for (const candidate of CANDIDATES) terms.push(await measureTerm(engine, baseVocabulary, pool, candidate));
  const winners = terms.filter(t => t.becomes > 0).sort((a, b) => b.becomes - a.becomes);
  const patch = { add: { sdr: SDR_TERMS, cold_caller: COLD_TERMS } };
  const after = await buildCandidateEngine(applyVocabularyPatch(baseVocabulary, patch));
  const combined = { sdr: 0, cold_caller: 0, opened: 0, openedES: 0, sources: {} };
  for (const row of pool) {
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
    view: { es: roleCounts(esView.cards), any: roleCounts(anyView.cards), extraRoles: true },
  };

  if (json) { console.log(JSON.stringify(report, null, 2)); return 0; }

  console.log(`Instantánea ${cached ? 'reutilizada' : 'recién exportada'} de ${snapshot.exportedAt} · ventana ${WINDOW} caracteres`);
  console.log(`${num(rows.length)} anuncios recogidos · ${num(report.titles)} títulos únicos`);

  const esCounts = roleCounts(esView.cards);
  const anyCounts = roleCounts(anyView.cards);
  const famLine = counts => ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr']
    .map(role => `${role} ${num(counts[role] ?? 0)}`).join(' · ');
  console.log(`\nVISTA DE ESPAÑA (studentSurface, roles extra incluidos): ${num(esView.cards.length)} tarjetas`);
  console.log(`  ${famLine(esCounts)}`);
  console.log(`VISTA «CUALQUIER MERCADO»: ${num(anyView.cards.length)} tarjetas`);
  console.log(`  ${famLine(anyCounts)}`);

  console.log('\n== QUIÉN TRAE HOY SDR Y COLD CALLER (tarjetas visibles en España) ==');
  console.log(`${pad('fuente', 34)}${pad('anuncios', 10)}${pad('títulos', 9)}${pad('visibles', 9)}${pad('sdr', 6)}${pad('cold', 6)}${pad('closer', 8)}${pad('setter', 8)}AE`);
  for (const row of sources.slice(0, 20)) {
    console.log(`${pad(row.source, 34)}${pad(num(row.rows), 10)}${pad(num(row.titles), 9)}${pad(num(row.visibles), 9)}${pad(num(row.sdr), 6)}${pad(num(row.cold), 6)}${pad(num(row.closer), 8)}${pad(num(row.setter), 8)}${num(row.ae)}`);
  }
  const rest = sources.slice(20).reduce((n, row) => n + row.visibles, 0);
  if (rest) console.log(`${pad('(otras fuentes)', 34)}${pad('', 10)}${pad('', 9)}${pad(num(rest), 9)}`);
  const targetRows = sources.reduce((n, row) => n + row.target, 0);
  console.log(`\nsdr + cold_caller visibles en España: ${num(targetRows)} de ${num(esView.cards.length)} tarjetas`);

  console.log('\n== TÉRMINOS CANDIDATOS (cuántos anuncios YA recogidos pasan a sdr / cold_caller) ==');
  console.log(`${pad('término', 38)}${pad('familia', 13)}${pad('títulos', 9)}${pad('eligs ES', 10)}${pad('ya era', 8)}${pad('pasan ES', 10)}${pad('pasan', 7)}${pad('pierden', 9)}de dónde salen`);
  for (const term of terms) {
    const from = Object.entries(term.sources).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([source, n]) => `${source} ${n}`).join(', ');
    console.log(`${pad(term.term, 38)}${pad(term.family, 13)}${pad(num(term.matched), 10)}${pad(num(term.eligible), 10)}${pad(num(term.already), 8)}${pad(num(term.becomesES), 10)}${pad(num(term.becomes), 7)}${pad(num(term.lost), 9)}${from || '—'}`);
  }

  console.log('\n== SI SE AÑADIERAN TODOS LOS CANDIDATOS ==');
  console.log(`títulos únicos que cambian de familia: ${num(combined.opened)} (sdr +${num(combined.sdr)}, cold_caller +${num(combined.cold_caller)}) · de esos, visibles hoy en la vista de España: ${num(combined.openedES)}`);
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
