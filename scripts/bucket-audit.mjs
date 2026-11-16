#!/usr/bin/env node
// ¿Cuántas veces la vista de la alumna rellena con ofertas de OTRA familia? Solo lectura.
//
// La web (apps/web/components/StudentOpportunities.tsx) pide la búsqueda estrecha y, si vuelven
// menos de 10 ofertas y hay algún filtro puesto, pide una SEGUNDA búsqueda más ancha —sin rol y
// con el idioma que eligió la alumna— y la enseña en el bloque «hueco ampliado». Este script mide ese relleno con el
// motor de verdad: llama a `studentSurface` (la MISMA función que sirve /v1/opportunities/search)
// contra el catálogo real, sobre un shim de D1 que solo devuelve filas ya leídas con un SELECT.
//
// Uso:
//   npm run bucket:audit
//   npm run bucket:audit -- --json
//
// No recoge, no escribe y no despliega: la única consulta que sale de aquí es un SELECT.
import { pathToFileURL } from 'node:url';
import { currentEngine, assertSelectOnly, query } from './vocabulary-audit.mjs';

const ROLE_FILTERS = ['closer', 'setter', 'cold_caller', 'account_executive', 'sdr'];
const MARKETS = ['any', 'ES', 'EU', 'LATAM', 'US'];
const DAYS = [1, 3, 7, 10];
const BILINGUAL = [false, true];
// Espejo de la web: si la búsqueda estrecha no llega a 10 y hay filtro, se añade un hueco.
export const WIDEN_BELOW = 10;
export const TOTAL_TARGET = 20;

export const shouldWiden = (narrow, { role, market }) =>
  narrow.length < WIDEN_BELOW && Boolean(role || market !== 'any');

// Misma petición ampliada que arma StudentOpportunities.tsx: quita el rol y el marcador de
// guardadas, y NO toca nada más — sobre todo el idioma: encender bilingües aquí colaba ofertas
// en inglés que nadie pidió.
export const widerRequest = applied => ({ ...applied, role: null, starred_only: false });

// Mismo corte que StudentOpportunities.tsx: se descartan las que ya salieron y se rellena hasta 20.
export function planWidening(narrow, widerRanked) {
  const seen = new Set(narrow.map(offer => offer.id));
  return widerRanked.filter(offer => !seen.has(offer.id)).slice(0, Math.max(0, TOTAL_TARGET - narrow.length));
}

// Las filas que miraría la superficie: el mismo SQL y el mismo LIMIT 800 que `studentSurface`,
// con la revisión editorial ya aplicada (la vista pública solo sirve approved/published).
export function poolSql(nowMs) {
  return `SELECT j.id AS job_id, j.starred AS starred, p.payload AS payload, p.source AS source, c.expires_at AS expires_at
    FROM catalog_entries c
    JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
    JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
    JOIN opportunities o ON o.org_id=c.org_id AND o.job_id=c.job_id
      AND o.editorial_status IN ('approved','published')
    WHERE c.org_id='cloud-wdc' AND c.expires_at > ${Number(nowMs)}
    ORDER BY c.first_seen_at DESC, j.id LIMIT 800`;
}

// Shim mínimo de D1: `studentSurface` solo hace prepare().bind().all() y recibe resultados.
const shim = rows => ({ DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } });

async function measure(engine, rows) {
  const env = shim(rows);
  const surface = (opts) => engine.studentSurface(env, { starredOnly: false, includeExtraRoles: false, ...opts });
  const combos = [];
  for (const role of [null, ...ROLE_FILTERS]) {
    for (const market of MARKETS) {
      for (const days of DAYS) {
        for (const includeBilingual of BILINGUAL) {
          const narrow = await surface({ role, market, days, includeBilingual });
          const query0 = { role, market, days, includeBilingual };
          if (!shouldWiden(narrow.ranked, query0)) { combos.push({ ...query0, narrow: narrow.ranked.length, wider: 0, foreign: 0, bilingualOnly: 0, families: {} }); continue; }
          const wide = await surface(widerRequest(query0));
          const extras = planWidening(narrow.ranked, wide.ranked);
          const foreign = extras.filter(offer => offer.role !== role);
          const families = {};
          for (const offer of foreign) families[offer.role] = (families[offer.role] ?? 0) + 1;
          combos.push({
            ...query0,
            narrow: narrow.ranked.length,
            wider: extras.length,
            foreign: foreign.length,
            bilingualOnly: foreign.filter(offer => offer.language !== 'Anuncio en español').length,
            families,
          });
        }
      }
    }
  }
  const triggered = combos.filter(c => c.wider > 0);
  const families = {};
  for (const c of triggered) { for (const [role, n] of Object.entries(c.families)) families[role] = (families[role] ?? 0) + n; }
  const widest = triggered.reduce((worst, c) => (!worst || c.foreign / (c.narrow + c.wider) > worst.foreign / (worst.narrow + worst.wider) ? c : worst), null);
  const roleTriggered = triggered.filter(c => c.role);
  return {
    pool: rows.length,
    combos: combos.length,
    triggered: triggered.length,
    roleCombos: combos.filter(c => c.role).length,
    roleTriggered: roleTriggered.length,
    extraCards: triggered.reduce((n, c) => n + c.wider, 0),
    foreignCards: triggered.reduce((n, c) => n + c.foreign, 0),
    bilingualCards: triggered.reduce((n, c) => n + c.bilingualOnly, 0),
    averageNarrow: triggered.length ? Math.round((triggered.reduce((n, c) => n + c.narrow, 0) / triggered.length) * 10) / 10 : 0,
    averageExtras: triggered.length ? Math.round((triggered.reduce((n, c) => n + c.wider, 0) / triggered.length) * 10) / 10 : 0,
    families,
    widest,
    detail: combos,
  };
}

function summarizeByRole(detail, key = 'role') {
  const out = {};
  for (const c of detail) {
    const name = key === 'role' ? (c.role ?? 'todos los perfiles') : c.market;
    const row = out[name] ?? (out[name] = { combos: 0, triggered: 0, narrow: 0, foreign: 0, worst: null });
    row.combos += 1;
    if (!c.wider) continue;
    row.triggered += 1;
    row.narrow += c.narrow;
    row.foreign += c.foreign;
    if (!row.worst || c.foreign > row.worst.foreign) row.worst = c;
  }
  return out;
}

async function main() {
  const json = process.argv.includes('--json');
  const engine = await currentEngine();
  const rows = query(assertSelectOnly(poolSql(Date.now())));
  const report = await measure(engine, rows);
  if (json) { console.log(JSON.stringify(report, null, 2)); return 0; }
  console.log(`Catálogo vivo que mira la vista: ${report.pool} filas (las 800 más recientes, approved/published)`);
  console.log(`Combinaciones probadas: ${report.combos} (perfil × mercado × días × bilingüe)\n`);
  console.log(`Se abre el hueco ampliado en ${report.triggered} de ${report.combos}`);
  console.log(`  · con perfil elegido: ${report.roleTriggered} de ${report.roleCombos}`);
  console.log(`  · ofertas extra mostradas: ${report.extraCards}`);
  console.log(`  · de OTRA familia que la pedida: ${report.foreignCards} (${report.extraCards ? Math.round((report.foreignCards / report.extraCards) * 100) : 0} %)`);
  console.log(`  · además solo visibles por el bilingüe que se añade: ${report.bilingualCards}`);
  console.log(`  · media por combinación abierta: ${report.averageNarrow} con el filtro + ${report.averageExtras} del hueco`);
  if (report.widest) console.log(`  · peor proporción: ${report.widest.foreign} de ${report.widest.narrow + report.widest.wider} tarjetas son de otra familia (${report.widest.role}, ${report.widest.market}, ${report.widest.days}d${report.widest.includeBilingual ? ', bilingüe' : ''})`);
  console.log('  · familias que rellenan:', report.families);
  console.log('\nPor mercado:');
  for (const [market, row] of Object.entries(summarizeByRole(report.detail, 'market'))) {
    console.log(`  ${market.padEnd(6)} abre en ${row.triggered}/${row.combos} · ${row.foreign} tarjetas de otra familia`);
  }
  console.log('\nPor perfil:');
  for (const [role, row] of Object.entries(summarizeByRole(report.detail))) {
    console.log(`  ${role.padEnd(20)} abre en ${row.triggered}/${row.combos} · extra ${row.foreign}${row.worst ? ` · peor caso: ${row.worst.foreign} de ${row.worst.wider} (${row.worst.market}, ${row.worst.days}d${row.worst.includeBilingual ? ', bilingüe' : ''}), estrecha ${row.worst.narrow}` : ''}`);
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main().catch(error => { console.error(`Error: ${error.message}`); return 2; });
}
