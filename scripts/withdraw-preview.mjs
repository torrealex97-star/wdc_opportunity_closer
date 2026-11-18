#!/usr/bin/env node
// Comprobación EN SECO de la retirada masiva del catálogo del motor. SOLO LECTURA.
//
// Para qué: antes de dejar que la regla nueva retire miles de borradores por «sin perfil», «sin
// mercado» o «sin idioma», este script pide al motor su plan de activación con `dry_run: true` y
// cuenta cuántas se retirarían POR MOTIVO. No escribe en D1, no recoge, no despliega y no puede
// aprobar ni retirar nada: el `dry_run` viaja fijo en el cuerpo de la petición y el script aborta si
// el motor responde que no era una simulación.
//
// Usa el CÓDIGO REAL del motor, no una copia de sus reglas: apunta a una instancia con el código que
// se quiere medir (`wrangler dev --remote` sirve el código local contra la D1 de producción) y le
// pasa los ids exactos de los borradores vivos. Así el recuento no puede desviarse de lo que hará la
// pasada de verdad.
//
// Uso:
//   npm run withdraw:preview                       # mercado any (el que usa el cron), código local
//   npm run withdraw:preview -- --also-es          # añade la comparación con mercado ES
//   npm run withdraw:preview -- --base https://…   # mide el motor desplegado
//   npm run withdraw:preview -- --json             # cifras para otro programa
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSelectOnly, query } from './vocabulary-audit.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// D1 admite un número acotado de parámetros por consulta; 90 ids + la organización van holgados.
const CHUNK = 90;
const ORG = 'cloud-wdc';

/** Los borradores vivos que el motor consideraría: el MISMO filtro que el SELECT de la activación. */
export function draftSql(now = new Date().toISOString()) {
  return assertSelectOnly(`
    SELECT o.id AS id, p.source AS source
      FROM opportunities o
      JOIN jobs j ON j.org_id=o.org_id AND j.id=o.job_id
      JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
      JOIN catalog_entries c ON c.org_id=o.org_id AND c.job_id=o.job_id
     WHERE o.org_id='${ORG}' AND o.editorial_status='draft' AND o.opportunity_status <> 'closed'
       AND c.expires_at > '${now}'`);
}

/** Recuento por motivo. Puro: la prueba lo ejecuta sin red. */
export function aggregate(items) {
  const out = { withdraw: {}, withdrawn: 0, publish: 0, review: 0, skipped: 0, other: 0 };
  for (const item of items) {
    if (item?.action === 'withdraw') {
      const reason = String(item.reason ?? 'sin motivo');
      out.withdraw[reason] = (out.withdraw[reason] ?? 0) + 1;
      out.withdrawn += 1;
    } else if (item?.action === 'publish_si_open') out.publish += 1;
    else if (item?.action === 'needs_review') out.review += 1;
    else if (item?.action === 'skipped') out.skipped += 1;
    else out.other += 1;
  }
  return out;
}

function readToken() {
  if (process.env.ENGINE_ADMIN_TOKEN) return process.env.ENGINE_ADMIN_TOKEN.trim();
  const secrets = join(ROOT, '.local/cloudflare-cut/secrets.env');
  if (existsSync(secrets)) {
    const line = readFileSync(secrets, 'utf8').split(/\r?\n/).find(row => row.startsWith('ADMIN_TOKEN='));
    if (line) return line.slice('ADMIN_TOKEN='.length).trim();
  }
  const file = join(ROOT, '.local/admin-token.txt');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Pide el plan de activación para un conjunto de ids. `dry_run` va fijo: este script no puede
 * escribir aunque se equivoque quien lo llama.
 */
export async function activatePlan(base, token, ids, market = 'any') {
  let response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/v1/admin/opportunities/activate`, {
      method: 'POST',
      headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true, verify: true, auto: false, market, ids }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const cause = error;
    throw new Error(`no se pudo hablar con el motor en ${base} (${cause?.cause?.code ?? cause?.message ?? String(error)}): arranca \`wrangler dev --remote\` en sites/engine o pasa --base`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`el motor respondió ${response.status}: ${body?.detail ?? 'sin detalle'}`);
  // Si el motor dejara de ser una simulación, el script no puede seguir contando como si nada.
  if (body?.dry_run !== true) throw new Error('el motor NO respondió en seco: se aborta sin contar nada');
  if (!Array.isArray(body.items)) throw new Error('el motor no devolvió el plan de items');
  return body;
}

function pad(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
const pct = (part, total) => (total ? `${((part / total) * 100).toFixed(1)} %` : '—');

function parseArgs(argv) {
  const args = { base: 'http://127.0.0.1:8787', market: 'any', alsoEs: false, json: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') args.base = argv[++i];
    else if (arg === '--market') args.market = argv[++i];
    else if (arg === '--also-es') args.alsoEs = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--limit') args.limit = Number(argv[++i]) || 0;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`opción desconocida: ${arg}`);
  }
  return args;
}

const HELP = `Uso: npm run withdraw:preview -- [--base URL] [--market any|ES] [--also-es] [--limit N] [--json]
  --base      motor a medir (por defecto http://127.0.0.1:8787, el de \`wrangler dev --remote\`)
  --market    any (por defecto, lo que usa el cron) o ES (exige señal de España)
  --also-es   añade una segunda pasada con mercado ES para comparar
  --limit     mide solo los primeros N borradores (prueba rápida)
  --json      salida legible por otro programa
No escribe nada: el motor recibe siempre dry_run: true.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  const token = readToken();
  if (!token) throw new Error('falta ENGINE_ADMIN_TOKEN (o .local/cloudflare-cut/secrets.env / .local/admin-token.txt)');

  const rows = query(draftSql());
  const all = rows.filter(row => typeof row.id === 'string' && row.id);
  const ids = args.limit ? all.slice(0, args.limit) : all;
  const perSource = new Map();
  for (const row of ids) perSource.set(row.source, (perSource.get(row.source) ?? 0) + 1);

  const runOne = async market => {
    const items = [];
    let considered = 0;
    let missing = 0;
    let truncated = false;
    for (const batch of chunk(ids.map(row => row.id), CHUNK)) {
      const plan = await activatePlan(args.base, token, batch, market);
      items.push(...plan.items);
      considered += Number(plan.considered) || 0;
      truncated = truncated || Boolean(plan.scan?.truncated);
      missing += batch.length - plan.items.length;
    }
    return { market, drafts: ids.length, considered, missing, truncated, ...aggregate(items) };
  };

  const markets = args.alsoEs ? [args.market, ...(args.market === 'ES' ? [] : ['ES'])] : [args.market];
  const reports = [];
  for (const market of markets) reports.push(await runOne(market));

  if (args.json) {
    console.log(JSON.stringify({ at: new Date().toISOString(), base: args.base, sources: perSource.size, reports }, null, 2));
    return 0;
  }

  console.log(`== COMPROBACIÓN EN SECO · retiradas del motor · ${new Date().toLocaleString('es-ES')} ==`);
  console.log(`Código: ${args.base} · datos: D1 de producción (una sola SELECT) · ${perSource.size} fuentes`);
  for (const report of reports) {
    console.log(`\n-- mercado ${report.market} --`);
    console.log(`Borradores vivos: ${pad(report.drafts)} · devueltos por el motor: ${pad(report.considered)}${report.missing ? ` · NO devueltos: ${pad(report.missing)}` : ''}`);
    console.log(`SE RETIRARÍAN ${pad(report.withdrawn)} de ${pad(report.drafts)}  ${pct(report.withdrawn, report.drafts)}`);
    const reasons = Object.entries(report.withdraw).sort((a, b) => b[1] - a[1]);
    if (!reasons.length) console.log('  (ninguna)');
    for (const [reason, n] of reasons) console.log(`  ${String(pad(n)).padStart(7)}  ${pct(n, report.drafts).padStart(6)}  ${reason}`);
    console.log(`SEGUIRÍAN ${pad(report.publish + report.review)}: ${pad(report.publish)} se publicarían si el enlace está abierto · ${pad(report.review)} a la cola humana`);
    if (report.skipped) console.log(`  no accionables en esta pasada: ${pad(report.skipped)}`);
    if (report.other) console.log(`  acciones no clasificadas: ${pad(report.other)}`);
    if (report.truncated) console.log('  AVISO: el motor declaró el barrido truncado; el recuento no está completo.');
  }
  console.log('\nNo se ha escrito nada: el motor recibió dry_run: true en todas las peticiones.');
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main().catch(error => { console.error(`Error: ${error.message}`); return 2; });
}
