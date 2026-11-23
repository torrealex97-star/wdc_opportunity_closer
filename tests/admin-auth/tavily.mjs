// Tavily: contrato (POST /search con Bearer), lectura de resultados, candidatos solo de portales con patrón de oferta,
// negativos del banco, errores (clave, límite, sin `results`), tope mensual y mínimo de búsquedas por pasada.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/tavily.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8798;
let calls = [], saved = [], runs = [], mode = 'ok', hasKey = true;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = ''; for await (const chunk of req) body += chunk;
  if (url.pathname === '/search') {
    calls.push({ auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    if (mode === 'badkey') return send(401, { detail: { error: 'Unauthorized: missing or invalid API key.' } });
    if (mode === 'limit') return send(432, { detail: { error: 'plan limit exceeded' } });
    if (mode === 'noresults') return send(200, { answer: null });
    return send(200, { results: [
      { title: 'Closer de ventas | InfoJobs', url: 'https://www.infojobs.net/ofertas-trabajo/madrid/of-i123', content: 'Buscamos closer de ventas con experiencia.', score: 0.9 },
      { title: 'Cerrajero urgente', url: 'https://www.infojobs.net/madrid/cerrajero/of-i124', content: 'Cerrajero 24 h', score: 0.8 },
      { title: 'Blog: cómo ser closer', url: 'https://blog.example.com/closer', content: 'artículo', score: 0.7 },
      { title: 'Setter remoto', url: 'https://www.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-setter-ABC123', content: 'Setter', score: 0.6 },
      { nope: true },
    ] });
  }
  if (url.pathname === '/rest/v1/integration_connections') return send(200, hasKey ? [{ secret_ciphertext: process.env.TEST_SECRET }] : []);
  if (url.pathname === '/rest/v1/source_settings') return send(200, []);
  if (url.pathname === '/rest/v1/rpc/external_upsert') { const rows = JSON.parse(body || '{}').p_rows ?? []; saved.push(...rows); return send(200, rows.length); }
  if (url.pathname === '/rest/v1/external_ingest_runs') { if (req.method === 'GET') return send(200, []); runs.push(JSON.parse(body || '{}')); return send(201, {}); }
  return send(404, {});
});
await new Promise(resolve => server.listen(PORT, resolve));
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.TAVILY_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.INTEGRATION_SECRET_KEY = 'k'.repeat(64);
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('tvly-key-123456');
const { tavilySearch, tavilyCandidates, tavilyDomains, TavilyError } = await import('../../apps/web/lib/providers/tavily.ts');
const { collectTavily, tavilyMaxSearches } = await import('../../apps/web/lib/tavilyCollect.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => {
  calls = []; saved = []; runs = []; mode = 'ok'; hasKey = true; delete process.env.TAVILY_MAX_SEARCHES; delete process.env.TAVILY_API_KEY;
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); }
};
const meter = (room = 10) => { const spent = { tavily: 0 }; return { global: { check: () => ({ ok: true }) }, check: () => (spent.tavily + 0.008 <= room ? { ok: true } : { ok: false, reason: 'Tope mensual de Tavily agotado' }), charge: (_p, usd) => { spent.tavily += usd; }, spent }; };

await step('contrato: POST /search con Bearer, búsqueda básica, dominios y ventana de fecha', async () => {
  await tavilySearch('tvly-key-123456', 'oferta de empleo closer en España', { timeRange: 'week', country: 'spain', domains: ['infojobs.net'], maxResults: 10 });
  const [c] = calls;
  assert.equal(c.auth, 'Bearer tvly-key-123456');
  assert.equal(c.body.search_depth, 'basic'); assert.equal(c.body.time_range, 'week'); assert.equal(c.body.country, 'spain');
  assert.deepEqual(c.body.include_domains, ['infojobs.net']); assert.equal(c.body.include_answer, false);
});

await step('candidatos: solo enlaces a una oferta concreta de un portal conocido; sin negativos ni artículos', async () => {
  const { results } = await tavilySearch('k', 'q');
  const cands = tavilyCandidates(results);
  assert.deepEqual(cands.map(c => c.title), ['Closer de ventas', 'Setter remoto'], 'el cerrajero, el blog y la fila rota no entran; el sufijo del portal se limpia');
  assert.equal(cands[0].raw.provider, 'tavily'); assert.equal(cands[0].description, 'Buscamos closer de ventas con experiencia.');
  assert.equal(cands[0].company, null, 'no se inventa empresa');
  assert.ok(tavilyDomains().includes('infojobs.net') && tavilyDomains().includes('linkedin.com'));
});

await step('errores: clave rechazada, límite y respuesta sin results se declaran (no son 0 ofertas)', async () => {
  mode = 'badkey'; await assert.rejects(tavilySearch('k', 'q'), e => e instanceof TavilyError && /clave rechazada/.test(e.message) && e.billed === false);
  mode = 'limit'; await assert.rejects(tavilySearch('k', 'q'), e => /límite/.test(e.message));
  mode = 'noresults'; await assert.rejects(tavilySearch('k', 'q'), e => /sin lista `results`/.test(e.message));
});

await step('recogida: guarda con la fuente tavily, anota el gasto y no pasa del máximo (2 por defecto)', async () => {
  const m = meter();
  const out = await collectTavily('test', undefined, m, { now: Date.parse('2026-11-23T10:00:00Z') });
  assert.equal(out.ok, true); assert.equal(out.searches, 2); assert.equal(calls.length, 2);
  assert.ok(saved.length >= 2 && saved.every(r => r.raw?.provider === 'tavily'));
  assert.equal(out.cost_usd, 0.016);
  assert.ok(runs.some(r => r.source === 'tavily' && /proveedor=tavily/.test(r.note ?? '') && /coste_usd=0\.016000/.test(r.note)), 'gasto anotado');
  assert.ok(calls.every(c => /^(oferta de empleo|job opening) /.test(c.body.query)), 'consulta semántica del banco');
  assert.notEqual(calls[0].body.query, calls[1].body.query, 'cada búsqueda es distinta');
});

await step('recogida: mínimo diario (1 búsqueda), apagado con 0 y tope mensual agotado', async () => {
  let out = await collectTavily('test', undefined, meter(), { maxSearches: 1 });
  assert.equal(out.searches, 1);
  calls = []; process.env.TAVILY_MAX_SEARCHES = '0';
  out = await collectTavily('test', undefined, meter()); assert.equal(calls.length, 0); assert.match(out.error, /desactivado/);
  delete process.env.TAVILY_MAX_SEARCHES;
  out = await collectTavily('test', undefined, meter(0)); assert.equal(calls.length, 0); assert.match(out.error, /Tope mensual/);
  assert.equal(tavilyMaxSearches({ TAVILY_MAX_SEARCHES: '99' }), 8);
});

await step('recogida: sin clave no hace nada; la variable TAVILY_API_KEY sirve de reserva; una clave rechazada para la pasada', async () => {
  hasKey = false;
  let out = await collectTavily('test', undefined, meter());
  assert.equal(out.ok, false); assert.match(out.error, /Sin clave/); assert.equal(calls.length, 0);
  process.env.TAVILY_API_KEY = 'tvly-env-key';
  out = await collectTavily('test', undefined, meter(), { maxSearches: 1 });
  assert.equal(calls[0].auth, 'Bearer tvly-env-key');
  hasKey = true; calls = []; mode = 'badkey';
  out = await collectTavily('test', undefined, meter());
  assert.equal(calls.length, 1, 'un 401 detiene la pasada'); assert.equal(out.ok, false); assert.match(out.error, /clave rechazada/);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
server.close();
process.exit(failed ? 1 : 0);
