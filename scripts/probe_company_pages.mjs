#!/usr/bin/env node
// Sonda de las páginas de empleo que el motor ya vigila (paquete C1 del plan de ofertas).
//
// Qué hace, sin gastar ni escribir en la base:
//   1. Lee `GET /v1/company-targets` de `CAREER_ENGINE_URL` (si está definido) y las páginas de empleo
//      del repo (`companyWatchlist.ts`), sin repetir URL.
//   2. Pide cada página una vez, como el cron: lectura directa, User-Agent propio y sin desbloqueador.
//   3. Aplica el MISMO extractor de `jobPosting.ts` (JSON-LD, RSS y, si no hay nada, enlaces del sitio)
//      y cuenta lo que devuelve de verdad.
//   4. Escribe un informe en Markdown con HTTP, vía, ofertas, enlaces, bytes y la causa de lo que falla.
//
// Lo que NO hace: no paga un desbloqueador, no usa el navegador de Cloudflare ni Browserless, no
// ingiere nada y no añade empresas. Una página vacía por JavaScript se declara como tal, no como «0
// ofertas»: el informe es una medida, no una promesa.
//
// Uso:
//   node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs scripts/probe_company_pages.mjs
//   ... --out docs/evidence/company-pages-2026-11-22.md --engine https://motor.example
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPANY_WATCHLIST } from '../apps/web/lib/companyWatchlist.ts';
import { extractJobPostings, stripHtml } from '../apps/web/lib/jobPosting.ts';

const UA = 'WDC-jobs/1.0 (+company page probe)';
const WATCHED = new Set(['careers_page', 'ats_page', 'teamtailor_feed']);
const BLOCKED = new Set([401, 403, 429, 503]);

export const httpsPublic = value => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i.test(url.hostname)) return false;
    return url.hostname.includes('.');
  } catch { return false; }
};
export const keyOf = value => { try { const u = new URL(value); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return value; } };
export const cell = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';

export const rowsOf = (targets, origin) => targets
  .filter(t => WATCHED.has(String(t.monitoring)) && typeof t.careers_url === 'string' && httpsPublic(t.careers_url) && typeof t.slug === 'string')
  .map(t => ({ code: String(t.slug).slice(0, 60), name: String(t.name ?? t.slug), url: t.careers_url, note: `${origin} (${t.monitoring}).` }));

/** Lista semilla del motor: la misma con la que se pobló su base. Se usa solo si la ruta no existe. */
function seedPages() {
  try {
    const file = new URL('../apps/api/career/data/company_targets.json', import.meta.url);
    const rows = JSON.parse(readFileSync(file, 'utf8'));
    const pages = Array.isArray(rows) ? rowsOf(rows, 'Semilla del motor') : [];
    return { pages, note: `${pages.length} página(s) en la lista semilla del motor (no se pudo leer la base; puede haber cambiado).` };
  } catch (error) {
    return { pages: [], note: `No se pudo leer la lista semilla del motor: ${error.message}` };
  }
}

/** Páginas de empleo del motor: mismo filtro que `engineCareerPages`, sin importar el módulo del cron entero. */
async function enginePages(engine) {
  if (!engine) {
    const seed = seedPages();
    return { pages: seed.pages, note: `\`CAREER_ENGINE_URL\` no está definido. ${seed.note}` };
  }
  try {
    const response = await fetch(`${engine}/v1/company-targets`, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const seed = seedPages();
      return { pages: seed.pages, note: `El motor respondió HTTP ${response.status}${detail?.detail ? ` («${detail.detail}»)` : ''}. ${seed.note}` };
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.targets)) return { pages: [], note: 'El motor no devolvió `targets`: no se puede saber qué páginas vigila.' };
    const pages = rowsOf(payload.targets, 'Motor');
    return { pages, note: `${pages.length} página(s) de empleo declaradas por el motor.` };
  } catch (error) {
    const seed = seedPages();
    return { pages: seed.pages, note: `No se pudo leer el motor: ${error.message}. ${seed.note}` };
  }
}

export function merge(repo, fromEngine) {
  const seen = new Set();
  return [...repo, ...fromEngine].filter(page => { const k = keyOf(page.url); if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function probe(page) {
  const row = { code: page.code, name: page.name, url: page.url, status: null, via: null, jobs: 0, anchors: 0, bytes: 0, text: 0, note: page.note };
  try {
    const response = await fetch(page.url, { redirect: 'follow', signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8' } });
    row.status = response.status;
    const body = await response.text();
    row.bytes = Buffer.byteLength(body);
    row.anchors = (body.match(/<a\b[^>]*\shref\s*=/gi) ?? []).length;
    row.text = stripHtml(body).length;
    if (!response.ok) { row.note = `HTTP ${response.status}${BLOCKED.has(response.status) ? ' (bloqueo)' : ''}`; return row; }
    const detected = extractJobPostings(body, page.url, { anchors: true, company: page.name });
    row.jobs = detected.length;
    row.via = detected[0]?.via ?? null;
    if (!detected.length) {
      row.note = row.text < 300 && row.anchors < 3
        ? 'HTML vacío o casi vacío: probablemente se pinta con JavaScript (el cron usaría el navegador si estuviera configurado).'
        : 'Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer.';
    }
  } catch (error) {
    row.note = `Lectura fallida: ${error.message}`;
  }
  return row;
}

export async function main(argv = process.argv.slice(2)) {
  const flag = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
  const today = new Date().toISOString().slice(0, 10);
  const out = resolve(flag('out', `docs/evidence/company-pages-${today}.md`));
  const engine = (flag('engine', process.env.CAREER_ENGINE_URL ?? '')).replace(/\/+$/, '');
  const limit = Number(flag('limit', '0')) || 0;
  const repoPages = COMPANY_WATCHLIST.filter(c => c.kind === 'careers' && c.url && httpsPublic(c.url))
    .map(c => ({ code: c.code, name: c.name, url: c.url, note: 'Lista verificada del repo.' }));
  const fromEngine = await enginePages(engine);
  let pages = merge(repoPages, fromEngine.pages);
  if (limit > 0) pages = pages.slice(0, limit);

  if (!pages.length) {
    console.error('No hay páginas de empleo que medir: ni el repo ni el motor declaran una URL HTTPS pública.');
    process.exit(1);
  }

  const rows = [];
  for (const page of pages) {
    process.stderr.write(`· ${page.name} … `);
    const row = await probe(page);
    process.stderr.write(`${row.status ?? 'sin respuesta'} · ${row.jobs} oferta(s)\n`);
    rows.push(row);
  }

  const withJobs = rows.filter(r => r.jobs > 0);
  const blocked = rows.filter(r => r.status !== null && BLOCKED.has(r.status));
  const failed = rows.filter(r => r.status === null);
  const emptyJs = rows.filter(r => r.note?.startsWith('HTML vacío'));
  const lines = [
    `# Páginas de empleo que vigila el motor: lectura real — ${today}`,
    '',
    'Generado por `scripts/probe_company_pages.mjs`. Mide la lectura **directa** (sin desbloqueador de pago,',
    'sin navegador propio) con el mismo extractor del cron: JSON-LD `JobPosting`, RSS y, si no hay nada',
    'estructurado, los enlaces del propio sitio. Una página vacía por JavaScript se declara como tal; no',
    'se cuenta como «0 ofertas». No ingiere ni escribe en la base.',
    '',
    `- **Páginas medidas:** ${rows.length} (${repoPages.length} del repo, ${fromEngine.pages.length} del motor antes de quitar repetidas)`,
    `- **Con ofertas:** ${withJobs.length} · **Bloqueadas (401/403/429/503):** ${blocked.length} · **Sin respuesta:** ${failed.length} · **Vacías por JavaScript:** ${emptyJs.length}`,
    `- **Motor:** ${fromEngine.note}`,
    '',
    '| Empresa | Código | Página | HTTP | Vía | Ofertas | Enlaces | Bytes | Texto | Nota |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${cell(r.name)} | ${cell(r.code)} | ${cell(r.url)} | ${cell(r.status)} | ${cell(r.via)} | ${r.jobs} | ${r.anchors} | ${r.bytes} | ${r.text} | ${cell(r.note)} |`),
    '',
    '## Qué dice esto y qué no',
    '',
    '- **Sí:** qué páginas responden a una lectura directa, cuáles bloquean, cuáles se pintan con JavaScript y cuántas ofertas saca el extractor de cada una.',
    '- **No:** no se ha usado el desbloqueador de pago ni el navegador propio, así que una página bloqueada o vacía aquí puede leerse con esas vías (el cron lo intenta). Tampoco se ha aprobado ninguna oferta: lo extraído entraría como borrador.',
  ];

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Informe: ${out}`);
  console.log(`${rows.length} páginas · ${withJobs.length} con ofertas · ${blocked.length} bloqueadas · ${failed.length} sin respuesta · ${emptyJs.length} vacías por JavaScript`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exit(1); });
}
