// Rutas del servicio de voz (2026-11-24): qué proveedor usar (con su clave), incidencias y salto al siguiente. Base simulada.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voiceworker.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8800;
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test'; process.env.INTEGRATION_SECRET_KEY = 'k'.repeat(64);
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
let connections = [], events = [], mode = 'ok';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
  const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (mode === 'down') return send(500, {});
  if (url.pathname === '/rest/v1/integration_connections') {
    const eq = url.searchParams.get('provider')?.replace('eq.', '');
    return send(200, connections.filter(c => !eq || c.provider === eq));
  }
  if (url.pathname === '/rest/v1/voice_provider_events') {
    if (req.method === 'POST') { if (mode === 'writefail') return send(500, {}); events.unshift({ ...JSON.parse(body), created_at: new Date().toISOString() }); return send(201, null); }
    return send(200, events);
  }
  return send(404, {});
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const key = (provider, secret, updated = '2026-11-20T00:00:00Z') => ({ provider, last4: secret.slice(-4), updated_at: updated, secret_ciphertext: encryptSecret(secret) });
const { GET } = await import('../../apps/web/app/api/voice/provider/route.ts');
const { POST } = await import('../../apps/web/app/api/voice/provider-event/route.ts');

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const TOKEN = 'worker-token-0123456789abcdef';
const get = (token = TOKEN) => GET(new Request('http://x/api/voice/provider', { headers: { authorization: `Bearer ${token}` } }));
const post = (body, token = TOKEN) => POST(new Request('http://x/api/voice/provider-event', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));

await step('sin token configurado 503; con token malo 401', async () => {
  delete process.env.VOICE_WORKER_TOKEN; assert.equal((await get()).status, 503); assert.equal((await post({})).status, 503);
  process.env.VOICE_WORKER_TOKEN = TOKEN; assert.equal((await get('otro-token-que-no-vale-nada-1234')).status, 401); assert.equal((await post({}, 'otro-token-que-no-vale-nada-1234')).status, 401);
});
await step('sin ninguna clave guardada: 503 y el motivo de cada proveedor', async () => {
  const r = await get(); assert.equal(r.status, 503); const d = await r.json();
  assert.equal(d.order.length, 4); assert.ok(d.order.every(e => e.state === 'sin_clave')); assert.ok(!JSON.stringify(d).includes('sk-'));
});
await step('solo Deepgram guardada: se elige Deepgram y se entrega SU clave (y solo la suya)', async () => {
  connections = [key('deepgram', 'dg-secret-key-1111')];
  const r = await get(); assert.equal(r.status, 200); const d = await r.json();
  assert.equal(d.provider, 'deepgram_agent'); assert.equal(d.api_key, 'dg-secret-key-1111'); assert.deepEqual(d.fallbacks, []);
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.ok(!JSON.stringify(d.order).includes('dg-secret'), 'el orden no lleva claves');
});
await step('con OpenAI y Deepgram: gana la más barata y la otra queda de reserva', async () => {
  connections = [key('deepgram', 'dg-secret-key-1111'), key('openai', 'sk-openai-2222')];
  const d = await (await get()).json(); assert.equal(d.provider, 'openai_realtime_mini'); assert.equal(d.api_key, 'sk-openai-2222');
  assert.deepEqual(d.fallbacks, ['deepgram_agent', 'openai_realtime']);
});
await step('el servicio avisa de un pago rechazado: se anota y la siguiente vez se usa Deepgram', async () => {
  assert.equal((await post({ provider: 'openai_realtime_mini', kind: 'payment', detail: 'HTTP 402 insufficient_quota' })).status, 200);
  assert.equal(events[0].kind, 'payment');
  const d = await (await get()).json(); assert.equal(d.provider, 'deepgram_agent'); assert.equal(d.order.find(e => e.id === 'openai_realtime_mini').state, 'pausado_pago');
});
await step('guardar otra clave de OpenAI después del pago la reactiva', async () => {
  connections = [key('deepgram', 'dg-secret-key-1111'), key('openai', 'sk-openai-nueva-3333', new Date(Date.now() + 5000).toISOString())];
  assert.equal((await (await get()).json()).provider, 'openai_realtime_mini');
});
await step('incidencias no válidas 422; una anotación que no se guarda 503; base caída: no se elige a ciegas', async () => {
  assert.equal((await post({ provider: 'nadie', kind: 'ok' })).status, 422); assert.equal((await post({ provider: 'deepgram_agent', kind: 'roto' })).status, 422);
  mode = 'writefail'; assert.equal((await post({ provider: 'deepgram_agent', kind: 'error' })).status, 503);
  mode = 'down'; const r = await get(); assert.equal(r.status, 503); assert.ok((await r.json()).order.every(e => e.state === 'sin_leer')); mode = 'ok';
});

server.close();
for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
