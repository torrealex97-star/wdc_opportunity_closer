// RapidAPI: una clave para varias APIs de empleo (JSearch, Jobs API LinkedIn e Indeed). Contrato de cabeceras,
// lectura de cada forma de respuesta, API sin suscripción, cuota agotada, clave rechazada y tope mensual.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/rapidapi.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8797;
let calls = [];
let saved = [];
let runs = [];
let mode = {};           // por host: 'ok' | 'nosub' | 'quota' | 'badkey'
let hasKey = true;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = '';
  for await (const chunk of req) body += chunk;
  if (url.pathname === '/search' || url.pathname.startsWith('/v2/')) {
    const host = req.headers['x-rapidapi-host'];
    calls.push({ host, path: url.pathname, key: req.headers['x-rapidapi-key'], params: Object.fromEntries(url.searchParams) });
    const m = mode[host] ?? 'ok';
    if (m === 'nosub') return send(403, { message: 'You are not subscribed to this API.' });
    if (m === 'quota') return send(429, { message: 'You have exceeded the MONTHLY quota' });
    if (m === 'badkey') return send(401, { message: 'Invalid API key' });
    if (url.pathname === '/search') {
      return send(200, { status: 'OK', request_id: 'r1', data: [
        { job_id: 'j1', job_title: 'Closer de ventas', employer_name: 'Acme', job_publisher: 'LinkedIn', job_city: 'Madrid', job_country: 'ES', job_apply_link: 'https://acme.test/j1', job_posted_at: 'hace 2 días' },
        { job_id: 'j2', job_title: 'Sin enlace', employer_name: 'Beta' },
      ] });
    }
    return send(200, { data: [{ id: 'x1', title: `Closer ${url.pathname.includes('indeed') ? 'Indeed' : 'LinkedIn'}`, companyName: 'Gamma', location: 'Barcelona', applyUrl: `https://gamma.test${url.pathname}/x1`, postedTimeAgo: '1 day ago' }], errors: [], hasError: false });
  }
  if (url.pathname === '/rest/v1/integration_connections') return send(200, hasKey ? [{ secret_ciphertext: process.env.TEST_SECRET }] : []);
  if (url.pathname === '/rest/v1/source_settings') return send(200, []);
  if (url.pathname === '/rest/v1/rpc/external_upsert') { const rows = JSON.parse(body || '{}').p_rows ?? []; saved.push(...rows); return send(200, rows.length); }
  if (url.pathname === '/rest/v1/external_ingest_runs') {
    if (req.method === 'GET') return send(200, runs.map(r => ({ note: r.note })));
    runs.push(JSON.parse(body || '{}')); return send(201, {});
  }
  if (url.pathname === '/rest/v1/provider_budget') return send(200, []);
  return send(404, {});
});
await new Promise(resolve => server.listen(PORT, resolve));

process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.RAPIDAPI_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.INTEGRATION_SECRET_KEY = 'k'.repeat(64);
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('rapid-key-123456');
const { RAPIDAPI_JOB_APIS, rapidApiJobs } = await import('../../apps/web/lib/providers/rapidapi.ts');
const { collectRapidApi } = await import('../../apps/web/lib/rapidapiCollect.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => {
  calls = []; saved = []; runs = []; mode = {}; hasKey = true; delete process.env.RAPIDAPI_MAX_REQUESTS;
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
};
const meter = (room = 10) => {
  const spent = { rapidapi: 0 };
  return { check: () => (spent.rapidapi + 0.005 <= room ? { ok: true } : { ok: false, reason: 'Tope mensual de RapidAPI agotado' }), charge: (_p, usd) => { spent.rapidapi += usd; }, spent, caps: {}, affordable: () => 0 };
};
const [jsearch, linkedin, indeed] = RAPIDAPI_JOB_APIS;

await step('contrato: X-RapidAPI-Key y X-RapidAPI-Host de cada API, con sus parámetros documentados', async () => {
  await rapidApiJobs('rapid-key-123456', jsearch, 'closer', 'es');
  await rapidApiJobs('rapid-key-123456', linkedin, 'closer', 'es');
  await rapidApiJobs('rapid-key-123456', indeed, 'closer', 'es');
  assert.deepEqual(calls.map(c => [c.host, c.path]), [['jsearch.p.rapidapi.com', '/search'], ['jobs-api14.p.rapidapi.com', '/v2/linkedin/search'], ['jobs-api14.p.rapidapi.com', '/v2/indeed/search']]);
  assert.ok(calls.every(c => c.key === 'rapid-key-123456'));
  assert.equal(calls[0].params.country, 'es'); assert.equal(calls[0].params.num_pages, '1');
  assert.equal(calls[1].params.location, 'Spain'); assert.equal(calls[2].params.countryCode, 'es');
});

await step('lee la forma de JSearch (data[] con job_*) y descarta lo que no tiene enlace', async () => {
  const out = await rapidApiJobs('k', jsearch, 'closer', 'es');
  assert.equal(out.candidates.length, 1, 'sin enlace no hay oferta');
  const [c] = out.candidates;
  assert.equal(c.title, 'Closer de ventas'); assert.equal(c.company, 'Acme'); assert.equal(c.url, 'https://acme.test/j1');
  assert.equal(c.location, 'Madrid, ES'); assert.equal(c.raw.provider, 'rapidapi'); assert.equal(c.raw.api, 'jsearch');
  assert.match(c.external_id, /^ra-jsearch-/);
});

await step('lee la forma de Jobs API (companyName, applyUrl)', async () => {
  const out = await rapidApiJobs('k', linkedin, 'closer', 'es');
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].company, 'Gamma');
  assert.equal(out.candidates[0].url, 'https://gamma.test/v2/linkedin/search/x1');
});

await step('una API sin suscripción (403) se declara como tal, no como clave mala, y no se cobra', async () => {
  mode['jsearch.p.rapidapi.com'] = 'nosub';
  await assert.rejects(rapidApiJobs('k', jsearch, 'closer', 'es'), err => /sin suscripción/.test(err.message) && err.billed === false);
});

await step('recogida: varias APIs, cada una con su fuente; una sin suscripción se salta y las demás siguen', async () => {
  mode['jsearch.p.rapidapi.com'] = 'nosub';
  const m = meter();
  const out = await collectRapidApi('test', undefined, m);
  assert.equal(out.ok, true);
  assert.equal(calls.filter(c => c.host === 'jsearch.p.rapidapi.com').length, 1, 'tras el 403 no se vuelve a pedir esa API');
  assert.ok(saved.length > 0, 'las ofertas de las APIs suscritas se guardan');
  assert.ok(out.by_api.jsearch.error.includes('sin suscripción'));
  assert.equal(out.by_api.jsearch.requests, 0, 'el 403 no cuenta como gasto');
  const spend = runs.filter(r => /proveedor=rapidapi/.test(r.note ?? ''));
  assert.ok(spend.length >= 1 && spend.every(r => /^rapidapi-(jobsapi-linkedin|jobsapi-indeed)$/.test(r.source)), 'el gasto se anota por API con su fuente (y no para la API sin suscripción)');
});

await step('recogida: no pasa del máximo por pasada ni del tope mensual', async () => {
  process.env.RAPIDAPI_MAX_REQUESTS = '2';
  let out = await collectRapidApi('test', undefined, meter());
  assert.equal(out.requests, 2);
  calls = [];
  out = await collectRapidApi('test', undefined, meter(0));
  assert.equal(calls.length, 0, 'sin tope no se lanza nada');
  assert.match(out.error, /Tope mensual/);
});

await step('recogida: sin clave no hace nada; con clave rechazada para enseguida', async () => {
  hasKey = false;
  let out = await collectRapidApi('test', undefined, meter());
  assert.equal(out.ok, false); assert.match(out.error, /Sin clave/); assert.equal(calls.length, 0);
  hasKey = true; mode = { 'jsearch.p.rapidapi.com': 'badkey' };
  out = await collectRapidApi('test', undefined, meter());
  assert.equal(calls.length, 1, 'un 401 detiene la pasada');
});

await step('cuota agotada (429) se dice y esa API se salta', async () => {
  mode['jobs-api14.p.rapidapi.com'] = 'quota';
  const out = await collectRapidApi('test', undefined, meter());
  assert.ok(Object.values(out.by_api).some(row => /cuota/.test(row.error ?? '')));
});

server.close();
console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
