#!/usr/bin/env node
// Embudo por motivos sobre lo YA recogido. Solo lectura.
//
// Responde «dónde se cae el embudo» sin adivinar: recorre los títulos guardados en D1 y aplica los
// mismos predicados que la visión de alumna —rol, idioma y mercado— para repartir el descarte en
// motivos. Comparte la instantánea de `vocabulary-audit.mjs` (.local/vocab-audit/snapshot.json) y,
// como aquel, la única consulta que lanza es un SELECT: no recoge, no escribe y no despliega.
//
// Uso:
//   npm run funnel:audit
//   npm run funnel:audit -- --market any --bilingual --json
//   npm run funnel:audit -- --refresh --max-age 0
import { pathToFileURL } from 'node:url';
import { currentEngine, loadSnapshot } from './vocabulary-audit.mjs';

// La instantánea guarda el anuncio sin URL; el motivo `sin_url` es de la ingesta y aquí no aplica
// (lo descartado por no tener enlace no llegó a guardarse con enlace). Se marca con una URL de
// relleno que solo existe en memoria para no confundir «sin enlace» con «sin datos».
const PLACEHOLDER_URL = 'https://snapshot.invalid/anuncio';

const ROLE_REASONS = ['familia_extra', 'sin_palabra_de_rol', 'mando', 'no_comercial'];
// Orden real del pipeline: se cae por rol al ingerir, y después por idioma y por mercado. Cada etapa
// se mide sobre lo que sobrevivió a la anterior, que es lo que hace legible el embudo.
export function funnel(rows, engine, { market = 'ES', includeBilingual = false } = {}) {
  const stages = { rol: { in: rows.length, out: Object.fromEntries(ROLE_REASONS.map(r => [r, 0])) }, idioma: { in: 0, out: 0 }, mercado: { in: 0, out: 0 } };
  const alive = [];
  for (const row of rows) {
    const payload = { title: row.title, location: row.location, url: PLACEHOLDER_URL, raw: { description: row.body ?? '' } };
    const reason = engine.discardReason(payload);
    if (reason) { stages.rol.out[reason] = (stages.rol.out[reason] ?? 0) + 1; continue; }
    alive.push(payload);
  }
  stages.idioma.in = alive.length;
  const spanish = alive.filter(payload => {
    const description = engine.descriptionOf(payload);
    if (String(description ?? '').trim().length < 40) { stages.idioma.sinTexto += 1; return false; }
    if (engine.spanishBodyGate(description, includeBilingual).ok) return true;
    stages.idioma.out += 1;
    return false;
  });
  stages.mercado.in = spanish.length;
  const pass = spanish.filter(payload => {
    if (!engine.marketRejects(payload, market)) return true;
    stages.mercado.out += 1;
    return false;
  });
  return {
    rows: rows.length,
    stages,
    pass: pass.length,
    leadershipInside: pass.filter(payload => engine.leadershipTitle(payload)).length,
  };
}

const pad = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pct = (part, total) => total ? `${((part / total) * 100).toFixed(1)} %`.padStart(6) : '     —';

const uniqueTitles = rows => new Set(rows.map(row => String(row.title ?? '').trim().toLowerCase()).filter(Boolean)).size;

function parseArgs(argv) {
  const args = { market: 'ES', bilingual: false, json: false, refresh: false, maxAgeHours: 12 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--market') args.market = argv[++i];
    else if (arg === '--bilingual') args.bilingual = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--refresh') args.refresh = true;
    else if (arg === '--max-age') args.maxAgeHours = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`opción desconocida: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Uso: npm run funnel:audit -- [--market ES|any|EU|LATAM|US] [--bilingual] [--refresh] [--json]');
    return 0;
  }
  const engine = await currentEngine();
  const { snapshot, cached } = loadSnapshot({ refresh: args.refresh, maxAgeHours: args.maxAgeHours });
  const options = { market: args.market, includeBilingual: args.bilingual };

  const report = { snapshotAt: snapshot.exportedAt, cached, ...options, universes: {} };
  for (const [name, rows] of [['collected', snapshot.collected], ['catalog', snapshot.catalog]]) {
    report.universes[name] = { ...funnel(rows, engine, options), titles: uniqueTitles(rows) };
  }

  if (args.json) { console.log(JSON.stringify(report, null, 2)); return 0; }
  console.log(`Instantánea ${cached ? 'reutilizada' : 'recién exportada'} de ${snapshot.exportedAt} · mercado ${args.market} · ${args.bilingual ? 'con bilingües' : 'solo castellano'}`);
  for (const [name, label] of [['collected', 'RECOGIDO (raw_items)'], ['catalog', 'CATÁLOGO (catalog_entries)']]) {
    const u = report.universes[name];
    console.log(`\n== ${label} ==`);
    console.log(`${pad(u.rows)} filas · ${pad(u.titles)} títulos únicos`);
    const { rol, idioma, mercado } = u.stages;
    console.log(`1) rol · ingresan ${pad(rol.in)}`);
    for (const reason of ROLE_REASONS) {
      if (!rol.out[reason]) continue;
      console.log(`     ${reason.padEnd(20)} ${pad(rol.out[reason]).padStart(7)}  ${pct(rol.out[reason], rol.in)}`);
    }
    console.log(`   quedan ${pad(idioma.in)}`);
    if (idioma.sinTexto) console.log(`     sin_texto            ${pad(idioma.sinTexto).padStart(7)}  ${pct(idioma.sinTexto, idioma.in)} (no se puede juzgar el idioma)`);
    console.log(`2) idioma · caen ${pad(idioma.out)} de ${pad(idioma.in)}  ${pct(idioma.out, idioma.in)}`);
    console.log(`   quedan ${pad(mercado.in)}`);
    console.log(`3) mercado ${args.market} · caen ${pad(mercado.out)} de ${pad(mercado.in)}  ${pct(mercado.out, mercado.in)}`);
    console.log(`   PASAN ${pad(u.pass)} de ${pad(u.rows)}  ${pct(u.pass, u.rows)}`);
    if (u.leadershipInside) console.log(`   de los que pasan, con pinta de mando: ${pad(u.leadershipInside)}`);
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main().catch(error => { console.error(`Error: ${error.message}`); return 2; });
}
