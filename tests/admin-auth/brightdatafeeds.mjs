// Feeds de Bright Data (LinkedIn Jobs): contrato (trigger → progreso → snapshot), lectura de registros, encargos pendientes
// que se recogen sin volver a pagar, no duplicar encargos, errores declarados, topes y mínimo diario.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/brightdatafeeds.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8799;
let calls = [], saved = [], runs = [], hasKey = true, progress = 'ready', triggerStatus = 200, snapshotBody = null;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  let body = ''; for await (const chunk of req) body += chunk;
  if (url.pathname === '/datasets/v3/trigger') {
    calls.push({ kind: 'trigger', auth: req.headers.authorization, query: Object.fromEntries(url.searchParams), body: JSON.parse(body || '{}') });
    return triggerStatus === 200 ? send(200, { snapshot_id: 'sd_test12345' }) : send(triggerStatus, { error: 'bad dataset' });
  }
  if (url.pathname.startsWith('/datasets/v3/progress/')) { calls.push({ kind: 'progress' }); return send(200, { status: progress }); }
  if (url.pathname.startsWith('/datasets/v3/snapshot/')) {
    calls.push({ kind: 'snapshot' });
    return send(200, snapshotBody ?? [
      { job_posting_id: '111', job_title: 'Closer de ventas high ticket', company_name: 'Acme', job_location: 'Madrid, España', job_summary: 'Buscamos closer con experiencia en ventas consultivas.', job_employment_type: 'Full-time', job_base_pay_range: '€30K-€45K', apply_link: 'https://acme.test/apply/111', url: 'https://www.linkedin.com/jobs/view/111', job_posted_date: '2026-11-22T10:00:00.000Z' },
      { job_posting_id: '112', job_title: 'Appointment Setter', url: 'https://www.linkedin.com/jobs/view/112' },
      { job_title: 'Sin enlace' },
      { error: 'dead page', input: { url: 'x' } },
      { job_posting_id: '111', job_title: 'Repetido', url: 'https://www.linkedin.com/jobs/view/111' },
    ]);
  }
  if (url.pathname === '/rest/v1/integration_connections') return send(200, hasKey ? [{ secret_ciphertext: process.env.TEST_SECRET }] : []);
  if (url.pathname === '/rest/v1/source_settings') return send(200, []);
  if (url.pathname === '/rest/v1/rpc/external_upsert') { const rows = JSON.parse(body || '{}').p_rows ?? []; saved.push(...rows); return send(200, rows.length); }
  if (url.pathname === '/rest/v1/external_ingest_runs') {
    if (req.method === 'GET') return send(200, runs.filter(r => r.source === 'brightdata-feed').map(r => ({ via: r.via, note: r.note })));
    runs.push(JSON.parse(body || '{}')); return send(201, {});
  }
  return send(404, {});
});
await new Promise(resolve => server.listen(PORT, resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.BRIGHTDATA_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.INTEGRATION_SECRET_KEY = 'k'.repeat(64);
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('bd-api-key-1234567890');
const { FEEDS, feedTrigger, feedCollect, feedCandidates, feedInput } = await import('../../apps/web/lib/providers/brightdataFeeds.ts');
const { runFeedStage, pendingFeeds, feedMaxSearches } = await import('../../apps/web/lib/brightdataFeedRun.ts');
const { MARKETS } = await import('../../apps/web/lib/searchBank.ts');
const { routesForSource } = await import('../../apps/web/lib/sourceRoutes.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => {
  calls = []; saved = []; runs = []; hasKey = true; progress = 'ready'; triggerStatus = 200; snapshotBody = null; delete process.env.BRIGHTDATA_FEED_MAX_SEARCHES; delete process.env.BRIGHTDATA_FEED_LIMIT;
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
};
const meter = (room = 10) => { const spent = { brightdata: 0 }; return { check: () => (spent.brightdata + 0.045 <= room ? { ok: true } : { ok: false, reason: 'Tope mensual de Bright Data agotado' }), charge: (_p, usd) => { spent.brightdata += usd; }, global: { check: () => ({ ok: true }) }, spent }; };
const linkedin = FEEDS.linkedin;

await step('contrato: trigger con dataset oficial de LinkedIn, discover_new por palabra clave, entrada y límite', async () => {
  assert.equal(linkedin.dataset, 'gd_lpfll7v5hcqtkxl6l');
  const input = feedInput('linkedin', { term: 'closer de ventas', market: MARKETS.es });
  assert.deepEqual(input, { keyword: 'closer de ventas', location: 'España', country: 'ES', time_range: 'Past week', selective_search: false });
  const out = await feedTrigger('bd-api-key-1234567890', linkedin, [input], { limitPerInput: 12 });
  assert.equal(out.snapshotId, 'sd_test12345');
  const [c] = calls;
  assert.equal(c.auth, 'Bearer bd-api-key-1234567890');
  assert.deepEqual({ ...c.query }, { dataset_id: 'gd_lpfll7v5hcqtkxl6l', include_errors: 'true', type: 'discover_new', discover_by: 'keyword', notify: 'false' });
  assert.equal(c.body.limit_per_input, 12); assert.deepEqual(c.body.input, [input]);
});

await step('registros → candidatos: título y enlace obligatorios, sin errores ni duplicados, nada inventado', async () => {
  const r = await feedCollect('k', 'sd_test12345');
  assert.equal(r.status, 'ready');
  const cands = feedCandidates(linkedin, r.records, Date.parse('2026-11-24T00:00:00Z'));
  assert.deepEqual(cands.map(c => c.title), ['Closer de ventas high ticket', 'Appointment Setter']);
  assert.equal(cands[0].company, 'Acme'); assert.equal(cands[0].location, 'Madrid, España'); assert.equal(cands[0].salary, '€30K-€45K');
  assert.equal(cands[0].apply_url, 'https://acme.test/apply/111'); assert.equal(cands[0].posted_at, '2026-11-22T10:00:00.000Z');
  assert.equal(cands[1].company, null, 'sin empresa en el registro: no se inventa'); assert.equal(cands[1].posted_at, null);
  assert.equal(cands[0].raw.provider, 'brightdata-feed');
});

await step('recogida: en marcha → pending; fallido y 404 se declaran; NDJSON y no-lista no son «0 ofertas»', async () => {
  progress = 'running'; assert.equal((await feedCollect('k', 'sd_x1234')).status, 'pending');
  progress = 'failed'; assert.equal((await feedCollect('k', 'sd_x1234')).status, 'failed');
  progress = 'ready'; snapshotBody = '{"job_title":"A","url":"https://l.test/1"}\n{"job_title":"B","url":"https://l.test/2"}';
  const nd = await feedCollect('k', 'sd_x1234'); assert.equal(nd.status, 'ready'); assert.equal(nd.records.length, 2);
  snapshotBody = { error: 'algo' }; const bad = await feedCollect('k', 'sd_x1234');
  assert.equal(bad.status, 'error'); assert.match(bad.detail, /no se interpreta como 0 ofertas/);
});

await step('trigger rechazado (HTTP 4xx) se dice con la causa y no se anota gasto', async () => {
  triggerStatus = 400;
  const out = await runFeedStage('test', undefined, meter());
  assert.equal(out.ok, false); assert.match(out.error, /rechazó el encargo.*400/);
  assert.equal(runs.filter(r => r.via === 'feed').length, 0);
});

await step('etapa: pide UNA búsqueda, anota gasto con snapshot_id y NO pide otra mientras haya un encargo en marcha', async () => {
  progress = 'running';
  const m = meter();
  const first = await runFeedStage('test', undefined, m, { now: Date.parse('2026-11-24T10:00:00Z') });
  assert.equal(first.ok, true); assert.equal(first.searches, 1); assert.equal(first.cost_usd, 0.045);
  const ledger = runs.filter(r => r.via === 'feed');
  assert.equal(ledger.length, 1); assert.match(ledger[0].note, /proveedor=brightdata/); assert.match(ledger[0].note, /coste_usd=0\.045000/); assert.match(ledger[0].note, /snapshot_id=sd_test12345/); assert.match(ledger[0].note, /feed=linkedin/);
  assert.deepEqual((await pendingFeeds()).map(p => p.id), ['sd_test12345']);
  calls = [];
  const second = await runFeedStage('test', undefined, m, { now: Date.parse('2026-11-24T10:05:00Z') });
  assert.equal(second.searches, 0, 'no se paga dos veces lo mismo'); assert.equal(calls.filter(c => c.kind === 'trigger').length, 0);
});

await step('etapa: lo pendiente se recoge gratis, se guarda y se marca hecho; luego sí puede pedir otra', async () => {
  progress = 'running';
  await runFeedStage('test', undefined, meter(), { now: Date.parse('2026-11-24T10:00:00Z'), maxSearches: 1 });
  progress = 'ready'; calls = []; saved = [];
  const out = await runFeedStage('test', undefined, meter(), { now: Date.parse('2026-11-24T11:00:00Z'), maxSearches: 0 });
  assert.equal(out.collected.collected, 1); assert.equal(out.accepted > 0, true); assert.equal(out.searches, 0, 'con maxSearches 0 solo recoge');
  assert.ok(saved.length >= 2 && saved.every(r => r.external_id.startsWith('bd-linkedin-')));
  assert.ok(runs.some(r => r.via === 'feed-done' && /snapshot_id=sd_test12345/.test(r.note) && /recogido/.test(r.note)));
  assert.deepEqual(await pendingFeeds(), [], 'ya no queda pendiente');
  assert.equal(calls.filter(c => c.kind === 'trigger').length, 0, 'recoger no paga');
});

await step('etapa: tope propio agotado, sin clave y apagado por entorno no piden nada', async () => {
  let out = await runFeedStage('test', undefined, meter(0), { maxSearches: 1 });
  assert.match(out.error, /Tope mensual/); assert.equal(calls.filter(c => c.kind === 'trigger').length, 0);
  hasKey = false; out = await runFeedStage('test', undefined, meter()); assert.match(out.error, /Sin clave de Bright Data/);
  hasKey = true; process.env.BRIGHTDATA_FEED_MAX_SEARCHES = '0'; assert.equal(feedMaxSearches(), 0);
  out = await runFeedStage('test', undefined, meter()); assert.equal(out.searches, 0);
  delete process.env.BRIGHTDATA_FEED_MAX_SEARCHES; assert.equal(feedMaxSearches({ BRIGHTDATA_FEED_MAX_SEARCHES: '99' }), 4);
});

await step('rutas: LinkedIn tiene la vía del feed delante de la búsqueda de Google; Indeed y Glassdoor aún no (sin campos leídos)', async () => {
  const routes = routesForSource({ code: 'linkedin', name: 'LinkedIn', website: 'https://www.linkedin.com', requires: 'input' });
  const ids = routes.map(r => r.provider);
  assert.ok(ids.includes('brightdata_feed')); assert.ok(ids.indexOf('brightdata_feed') < ids.indexOf('brightdata'));
  const feed = routes.find(r => r.provider === 'brightdata_feed');
  assert.equal(feed.requiresKey, 'brightdata'); assert.equal(feed.async, true);
  for (const code of ['indeed', 'glassdoor']) assert.ok(!routesForSource({ code, name: code, website: `https://www.${code}.com`, requires: 'input' }).some(r => r.provider === 'brightdata_feed'));
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
server.close();
process.exit(failed ? 1 : 0);
