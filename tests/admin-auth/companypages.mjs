// Páginas de empleo de empresas en el cron: cascada lectura directa → navegador propio → desbloqueador de pago, con el
// extractor de enlaces para páginas sin JSON-LD ni RSS, y la Fetch API de Bright Data (sin zona).
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/companypages.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8798;
let saved = [], runs = [], connections = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = ''; for await (const chunk of req) body += chunk;
  if (url.pathname === '/rest/v1/integration_connections') {
    if (url.search.includes('secret_ciphertext')) { const p = /provider=eq\.([a-z0-9]+)/.exec(url.search)?.[1]; return send(200, connections.includes(p) ? [{ secret_ciphertext: process.env.TEST_SECRET }] : []); }
    return send(200, connections.map(provider => ({ provider })));
  }
  if (url.pathname === '/rest/v1/source_settings') return send(200, []);
  if (url.pathname === '/v1/company-targets') return send(200, { targets: [
    { slug: 'ironhack', name: 'Ironhack', monitoring: 'careers_page', careers_url: 'https://jobs.ironhack.com/' },
    { slug: 'ph', name: 'Product Hackers', monitoring: 'teamtailor_feed', careers_url: 'https://producthackers.teamtailor.com/jobs' },
    { slug: 'manual', name: 'Manual', monitoring: 'manual', careers_url: 'https://manual.test/empleo' },
    { slug: 'mail', name: 'Correo', monitoring: 'careers_page', careers_url: 'mailto:rrhh@x.test' },
    { slug: 'li', name: 'Solo LinkedIn', monitoring: 'linkedin_guest', careers_url: 'https://www.linkedin.com/company/x' },
    { slug: 'dup', name: 'Bastida (repetida)', monitoring: 'careers_page', careers_url: 'https://www.bastidafarina.com/equipo/posiciones-abiertas/' },
  ] });
  if (url.pathname === '/rest/v1/rpc/external_upsert') { const rows = JSON.parse(body || '{}').p_rows ?? []; saved.push(...rows); return send(200, rows.length); }
  if (url.pathname === '/rest/v1/external_ingest_runs') { if (req.method === 'GET') return send(200, []); runs.push(JSON.parse(body || '{}')); return send(201, {}); }
  return send(404, {});
});
await new Promise(resolve => server.listen(PORT, resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.INTEGRATION_SECRET_KEY = 'k'.repeat(64);
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('secret-key-123456');
const { extractAnchorJobs, extractJobPostings } = await import('../../apps/web/lib/jobPosting.ts');
const { collectCompanyPages } = await import('../../apps/web/lib/companyPagesCollect.ts');
const { fetchApiHtml, BRIGHTDATA_FETCH_DATASET } = await import('../../apps/web/lib/providers/brightdata.ts');
const { renderHtml } = await import('../../apps/web/lib/providers/unlocker.ts');
const { engineCareerPages, mergePages } = await import('../../apps/web/lib/companyPagesCollect.ts');
const { COMPANY_WATCHLIST } = await import('../../apps/web/lib/companyWatchlist.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => {
  saved = []; runs = []; connections = []; delete process.env.BROWSERLESS_URL; delete process.env.BROWSERLESS_TOKEN; delete process.env.COMPANY_PAGES_MAX;
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.stack?.split('\n').slice(0, 3).join('\n      ') ?? err.message}`); }
};

const BASE = 'https://careers.acme.test/empleo';
const LIST = `<html><body><nav><a href="/">Inicio</a><a href="/empleo">Ver todas</a></nav>
  <a href="/empleo/closer-de-ventas-remoto">Closer de ventas remoto</a>
  <a href="https://careers.acme.test/empleo/setter-high-ticket?utm=x#apply"><span>Setter</span> high ticket</a>
  <a href="/empleo/closer-de-ventas-remoto">Closer de ventas remoto</a>
  <a href="/empleo/descripcion.pdf">Descripción del puesto PDF</a>
  <a href="https://otro-sitio.test/empleo/fraude-total">Oferta en otro sitio</a>
  <a href="/empleo/aplicar-ahora">Aplicar ahora</a>
  <a href="/blog/como-vender">Cómo vender más</a>
  <a href="mailto:rrhh@acme.test">rrhh@acme.test</a></body></html>`;
const JSONLD = `<script type="application/ld+json">{"@type":"JobPosting","title":"Closer estructurado","hiringOrganization":{"name":"Acme"},"url":"https://careers.acme.test/empleo/estructurado"}</script><a href="/empleo/otro-enlace">Otro enlace suelto</a>`;

await step('enlaces: solo ofertas del propio sitio, sin duplicados ni navegación; título = texto del enlace y nada inventado', () => {
  const jobs = extractAnchorJobs(LIST, BASE, { company: 'Acme' });
  assert.deepEqual(jobs.map(j => j.title), ['Closer de ventas remoto', 'Setter high ticket']);
  assert.equal(jobs[1].url, 'https://careers.acme.test/empleo/setter-high-ticket?utm=x', 'sin ancla #');
  for (const job of jobs) { assert.equal(job.company, 'Acme'); assert.equal(job.location, null); assert.equal(job.salary, null); assert.equal(job.posted_at, null); assert.equal(job.via, 'anchors'); assert.equal(job.raw.provider, 'html-anchors'); }
  assert.deepEqual(extractAnchorJobs('<a href="/empleo/x-y-z">Closer</a>', BASE, {}).map(j => j.company), [null], 'sin empresa indicada, no se supone ninguna');
});

await step('extractor común: los enlaces solo entran si se piden y la página no trae datos estructurados', () => {
  assert.equal(extractJobPostings(LIST, BASE).length, 0, 'por defecto («Revisar ahora») no cambia: sin JobPosting ni RSS, nada');
  assert.equal(extractJobPostings(LIST, BASE, { anchors: true }).length, 2);
  const structured = extractJobPostings(JSONLD, BASE, { anchors: true });
  assert.deepEqual(structured.map(j => [j.title, j.via]), [['Closer estructurado', 'jsonld']], 'con JobPosting no se mezclan enlaces sueltos');
});

const company = (code, host = 'careers.acme.test') => ({ code, name: `Empresa ${code}`, kind: 'careers', url: `https://${host}/empleo`, source: 'company', note: '' });
const meter = (ok = true) => { const spent = {}; return { check: provider => ok ? { ok: true } : { ok: false, reason: `Tope de ${provider} agotado` }, charge: (p, usd) => { spent[p] = (spent[p] ?? 0) + usd; }, spent, caps: {}, affordable: () => 0 }; };
const router = routes => { const calls = []; const impl = async (input, init) => { const u = String(input); calls.push(u); const hit = Object.entries(routes).find(([prefix]) => u.startsWith(prefix)); if (!hit) return new Response('sin ruta', { status: 599 }); const r = typeof hit[1] === 'function' ? hit[1](u, init) : hit[1]; return new Response(r.body, { status: r.status ?? 200 }); }; impl.calls = calls; return impl; };

await step('directa: con JSON-LD se guardan las ofertas, sin gasto; sin nada estructurado se leen los enlaces', async () => {
  const f = router({ 'https://careers.acme.test/empleo': { body: JSONLD } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: false, fetchImpl: f, list: [company('a')] });
  assert.equal(out.ok, true); assert.equal(out.pages[0].via, 'directa'); assert.equal(out.pages[0].extraction, 'jsonld'); assert.equal(out.cost_usd, 0);
  assert.ok(saved.length >= 1); assert.ok(runs.some(r => /company:a/.test(r.note ?? '')), 'la revisión queda en el historial');
  saved = [];
  const g = router({ 'https://careers.acme.test/empleo': { body: LIST } });
  const out2 = await collectCompanyPages('test', undefined, { allowPaid: false, fetchImpl: g, list: [company('b')] });
  assert.equal(out2.pages[0].extraction, 'anchors'); assert.equal(out2.pages[0].detected, 2);
});

await step('HTML vacío y sin navegador propio: no se paga nada (una página que responde bien no se desbloquea)', async () => {
  connections = ['zenrows'];
  const f = router({ 'https://careers.acme.test/empleo': { body: '<html><div id="root"></div></html>' }, 'https://api.zenrows.com': { body: LIST } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: true, meter: meter(), fetchImpl: f, list: [company('c')] });
  assert.equal(out.pages[0].detected, 0); assert.equal(out.cost_usd, 0);
  assert.ok(!f.calls.some(u => u.includes('zenrows')), 'ZenRows no se llama');
  assert.ok(!runs.some(r => /proveedor=/.test(r.note ?? '')), 'ningún gasto anotado');
});

await step('navegador propio: con BROWSERLESS_URL se renderiza la página vacía, gratis, y se leen sus ofertas', async () => {
  process.env.BROWSERLESS_URL = 'https://render.test'; process.env.BROWSERLESS_TOKEN = 'tok en';
  connections = ['zenrows'];
  const f = router({ 'https://careers.acme.test/empleo': { body: '<html><div id="root"></div></html>' }, 'https://render.test/content': (u, init) => { assert.match(u, /\?token=tok%20en$/); assert.equal(JSON.parse(init.body).url, 'https://careers.acme.test/empleo'); return { body: LIST }; }, 'https://api.zenrows.com': { body: 'no debe llamarse', status: 500 } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: true, meter: meter(), fetchImpl: f, list: [company('d')] });
  assert.equal(out.pages[0].via, 'navegador'); assert.equal(out.pages[0].detected, 2); assert.equal(out.cost_usd, 0);
  assert.ok(!f.calls.some(u => u.includes('zenrows')));
  await assert.rejects(renderHtml('http://inseguro.test/', { env: { BROWSERLESS_URL: 'https://render.test' } }), /HTTPS/);
  await assert.rejects(renderHtml('https://x.test/', { env: {} }), /BROWSERLESS_URL/);
});

await step('bloqueada (403) sin objetivo pendiente: no se paga y se dice por qué', async () => {
  connections = ['zenrows'];
  const f = router({ 'https://careers.acme.test/empleo': { body: 'denegado', status: 403 }, 'https://api.zenrows.com': { body: LIST } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: false, fetchImpl: f, list: [company('e')] });
  assert.equal(out.ok, false); assert.match(out.pages[0].error, /no se paga un desbloqueador/); assert.ok(!f.calls.some(u => u.includes('zenrows')));
});

await step('bloqueada (403) con objetivo pendiente y tope: ZenRows la lee, se carga al medidor y el gasto queda anotado', async () => {
  connections = ['zenrows'];
  const m = meter();
  const f = router({ 'https://careers.acme.test/empleo': { body: 'denegado', status: 403 }, 'https://api.zenrows.com': { body: LIST } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: true, meter: m, fetchImpl: f, list: [company('f')] });
  assert.equal(out.pages[0].via, 'zenrows'); assert.equal(out.pages[0].detected, 2); assert.ok(out.cost_usd > 0); assert.ok(m.spent.zenrows > 0);
  assert.ok(runs.some(r => /proveedor=zenrows/.test(r.note ?? '') && /company:f/.test(r.note ?? '')), 'gasto anotado con su proveedor');
});

await step('bloqueada con el tope agotado: no se lanza el de pago', async () => {
  connections = ['zenrows'];
  const f = router({ 'https://careers.acme.test/empleo': { body: 'denegado', status: 403 }, 'https://api.zenrows.com': { body: LIST } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: true, meter: meter(false), fetchImpl: f, list: [company('g')] });
  assert.match(out.pages[0].error, /sin clave de ZenRows, ScrapingBee ni Bright Data con tope/); assert.ok(!f.calls.some(u => u.includes('zenrows')));
});

await step('máximo por pasada y desactivado', async () => {
  process.env.COMPANY_PAGES_MAX = '2';
  const f = router({ 'https://': { body: LIST } });
  const out = await collectCompanyPages('test', undefined, { allowPaid: false, fetchImpl: f, list: [company('h1', 'a.test'), company('h2', 'b.test'), company('h3', 'c.test')] });
  assert.equal(out.checked, 2);
  process.env.COMPANY_PAGES_MAX = '0';
  const off = await collectCompanyPages('test', undefined, { allowPaid: false, fetchImpl: f, list: [company('h4')] });
  assert.match(off.error, /desactivadas/);
});

await step('Fetch API de Bright Data: contrato, NDJSON, JSON-LD añadido, 202 y registro con error', async () => {
  const cfg = { apiKey: 'key-123456', serpZone: null, unlockerZone: null };
  let seen;
  const ok = async (input, init) => { seen = { url: String(input), init }; return new Response(JSON.stringify({ url: 'https://x.test/', page_html: '<html>hola</html>', ld_json: { '@type': 'JobPosting', title: 'Closer' } }) + '\n', { status: 200 }); };
  const out = await fetchApiHtml(cfg, 'https://x.test/empleo', { fetchImpl: ok });
  assert.match(seen.url, new RegExp(`/datasets/v3/scrape\\?dataset_id=${BRIGHTDATA_FETCH_DATASET}`)); assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer key-123456'); assert.deepEqual(JSON.parse(seen.init.body), { input: [{ url: 'https://x.test/empleo' }] });
  assert.match(out.html, /hola/); assert.match(out.html, /application\/ld\+json/); assert.equal(out.requests, 1); assert.ok(out.costUsd > 0);
  await assert.rejects(fetchApiHtml(cfg, 'https://x.test/', { fetchImpl: async () => new Response('', { status: 202 }) }), e => e.status === 202 && /próxima pasada/.test(e.message));
  await assert.rejects(fetchApiHtml(cfg, 'https://x.test/', { fetchImpl: async () => new Response(JSON.stringify({ error: 'dead_page' }), { status: 200 }) }), /dead_page/);
  await assert.rejects(fetchApiHtml(cfg, 'http://x.test/', { fetchImpl: ok }), /HTTPS/);
});

await step('navegador propio en Cloudflare: contrato (cuenta, token, gotoOptions) y lectura de {success, result}', async () => {
  const env = { CF_BROWSER_ACCOUNT_ID: 'a'.repeat(32), CF_BROWSER_TOKEN: 'cf-tok', BROWSERLESS_URL: 'https://render.test' };
  let seen;
  const ok = async (input, init) => { seen = { url: String(input), init }; return new Response(JSON.stringify({ success: true, result: '<html>pintada</html>' }), { status: 200 }); };
  assert.equal(await renderHtml('https://x.test/empleo', { env, fetchImpl: ok }), '<html>pintada</html>');
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/browser-rendering/content`, 'con las dos configuradas manda Cloudflare');
  assert.equal(seen.init.headers.Authorization, 'Bearer cf-tok'); assert.equal(JSON.parse(seen.init.body).url, 'https://x.test/empleo');
  await assert.rejects(renderHtml('https://x.test/', { env, fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 2001, message: 'Rate limit exceeded' }] }), { status: 200 }) }), /Rate limit exceeded/);
  await assert.rejects(renderHtml('https://x.test/', { env, fetchImpl: async () => new Response('x', { status: 429 }) }), /HTTP 429/);
  await assert.rejects(renderHtml('https://x.test/', { env: { CF_BROWSER_ACCOUNT_ID: 'corta', CF_BROWSER_TOKEN: 't' } }), /falta CF_BROWSER_ACCOUNT_ID/, 'una cuenta mal escrita no cuenta como configurada');
});

await step('páginas del motor: solo las que vigila por página propia o ATS, HTTPS, y sin repetir las del repo', async () => {
  process.env.CAREER_ENGINE_URL = `http://127.0.0.1:${PORT}`;
  const engine = await engineCareerPages();
  assert.deepEqual(engine.map(c => c.code), ['ironhack', 'ph', 'dup'], 'fuera: manual, correo y solo LinkedIn');
  const merged = mergePages(COMPANY_WATCHLIST, engine);
  assert.ok(merged.some(c => c.code === 'bastida-farina') && !merged.some(c => c.code === 'dup'), 'la misma página no se lee dos veces');
  assert.ok(merged.some(c => c.code === 'ironhack'));
  delete process.env.CAREER_ENGINE_URL;
  assert.equal(await engineCareerPages(), null, 'sin motor configurado: null (no una lista vacía inventada)');
  assert.ok(mergePages(COMPANY_WATCHLIST, null).length >= 2, 'y se sigue con la lista del repo');
});

server.close();
console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
