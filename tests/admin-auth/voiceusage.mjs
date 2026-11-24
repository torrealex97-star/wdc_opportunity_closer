// Consumo real de voz (2026-11-24): lectura sin inventar ceros, anotación acotada a los 10 minutos del día, escritura fallida no contada
// y ruta del servicio de voz (token, interruptor, consentimiento). Base simulada: sin red real.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voiceusage.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8799;
process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
delete process.env.VOICE_DAILY_MINUTES;
let rows = [], mode = 'ok', consent = null;
const S1 = '00000000-0000-4000-8000-000000000001', S2 = '00000000-0000-4000-8000-000000000002';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
  const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/rest/v1/student_voice_consent') return send(200, consent ? [consent] : []);
  if (url.pathname !== '/rest/v1/voice_usage') return send(404, {});
  if (mode === 'missing') return send(404, { code: 'PGRST205' });
  if (req.method === 'POST') { if (mode === 'writefail') return send(500, {}); rows.push(JSON.parse(body)); return send(201, null); }
  const q = Object.fromEntries(url.searchParams); let out = rows;
  if (q.student_id?.startsWith('eq.')) out = out.filter(r => r.student_id === q.student_id.slice(3));
  if (q.day?.startsWith('eq.')) out = out.filter(r => r.day === q.day.slice(3));
  if (q.day?.startsWith('gte.')) out = out.filter(r => r.day >= q.day.slice(4));
  return send(200, out);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const { usedSecondsToday, monthSummary, recordVoiceUsage } = await import('../../apps/web/lib/voiceUsage.ts');
const { VOICE_CONSENT_VERSION } = await import('../../apps/web/lib/voice.ts');
const { POST } = await import('../../apps/web/app/api/voice/usage/route.ts');

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const NOW = new Date('2026-11-24T10:00:00Z');
const req = (body, token = 'worker-token-0123456789abcdef') => new Request('http://x/api/voice/usage', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

await step('sin filas, el consumo es 0 de verdad; con la tabla ausente es «no se pudo leer» (null), no 0', async () => {
  assert.equal(await usedSecondsToday(S1, NOW), 0); assert.deepEqual(await monthSummary(NOW), { spentUsd: 0, minutesToday: 0 });
  mode = 'missing'; assert.equal(await usedSecondsToday(S1, NOW), null); assert.equal(await monthSummary(NOW), null); mode = 'ok';
});
await step('anotar: guarda segundos y coste en el peor caso del proveedor, y la lectura lo suma', async () => {
  const r = await recordVoiceUsage({ studentId: S1, provider: 'openai_realtime_mini', seconds: 240 }, {}, NOW);
  assert.deepEqual(r, { ok: true, seconds: 240, costUsd: 0.2, remainingSeconds: 360 });
  assert.equal(rows[0].day, '2026-11-24'); assert.equal(rows[0].org_id.length > 0, true);
  assert.equal(await usedSecondsToday(S1, NOW), 240); assert.equal(await usedSecondsToday(S2, NOW), 0, 'cada alumna lo suyo');
  assert.deepEqual(await monthSummary(NOW), { spentUsd: 0.2, minutesToday: 4 });
});
await step('el tope de 10 minutos acota la sesión y al llegar no se anota más', async () => {
  const r = await recordVoiceUsage({ studentId: S1, provider: 'openai_realtime_mini', seconds: 900 }, {}, NOW);
  assert.equal(r.ok, true); assert.equal(r.seconds, 360); assert.equal(r.remainingSeconds, 0);
  const again = await recordVoiceUsage({ studentId: S1, provider: 'openai_realtime_mini', seconds: 10 }, {}, NOW);
  assert.deepEqual(again, { ok: false, kind: 'cap', error: 'La alumna ya llegó al límite diario de voz.' });
  assert.equal(rows.length, 2, 'lo rechazado no se guarda'); assert.equal(await usedSecondsToday(S1, NOW), 600);
});
await step('el día siguiente vuelve a haber minutos; el entorno puede bajar el tope pero no subirlo', async () => {
  const next = new Date('2026-11-25T08:00:00Z');
  assert.equal(await usedSecondsToday(S1, next), 0);
  const low = await recordVoiceUsage({ studentId: S1, provider: 'deepgram_agent', seconds: 600 }, { VOICE_DAILY_MINUTES: '2' }, next);
  assert.equal(low.seconds, 120);
});
await step('entradas no válidas se rechazan; una escritura fallida NO cuenta como hecha; lectura imposible no anota', async () => {
  for (const bad of [{ studentId: 'x', provider: 'deepgram_agent', seconds: 5 }, { studentId: S2, provider: 'nadie', seconds: 5 }, { studentId: S2, provider: 'deepgram_agent', seconds: 0 }, { studentId: S2, provider: 'deepgram_agent', seconds: NaN }])
    assert.equal((await recordVoiceUsage(bad, {}, NOW)).kind, 'invalid');
  const before = rows.length; mode = 'writefail';
  assert.equal((await recordVoiceUsage({ studentId: S2, provider: 'deepgram_agent', seconds: 30 }, {}, NOW)).kind, 'store'); assert.equal(rows.length, before);
  mode = 'missing'; assert.equal((await recordVoiceUsage({ studentId: S2, provider: 'deepgram_agent', seconds: 30 }, {}, NOW)).kind, 'store'); mode = 'ok';
});
await step('ruta del servicio de voz: 503 sin token, 401 con token malo, 403 sin interruptor o sin consentimiento, 200 con todo', async () => {
  delete process.env.VOICE_WORKER_TOKEN; delete process.env.VOICE_ROLEPLAY;
  assert.equal((await POST(req({ student_id: S2, provider: 'deepgram_agent', seconds: 20 }))).status, 503);
  process.env.VOICE_WORKER_TOKEN = 'worker-token-0123456789abcdef';
  assert.equal((await POST(req({}, 'otro-token-que-no-vale-nada-1234'))).status, 401);
  assert.equal((await POST(req({ student_id: S2, provider: 'deepgram_agent', seconds: 20 }))).status, 403, 'interruptor apagado');
  process.env.VOICE_ROLEPLAY = 'on';
  assert.equal((await POST(req({ student_id: S2, provider: 'deepgram_agent', seconds: 20 }))).status, 403, 'sin consentimiento');
  consent = { version: VOICE_CONSENT_VERSION, accepted_at: '2026-11-24T09:00:00Z', revoked_at: null };
  const ok = await POST(req({ student_id: S2, provider: 'deepgram_agent', seconds: 20 })); assert.equal(ok.status, 200);
  const data = await ok.json(); assert.equal(data.recorded_seconds, 20); assert.equal(data.cost_usd, 0.025);
  assert.equal((await POST(req({ student_id: S2, provider: 'nadie', seconds: 20 }))).status, 422);
});

server.close();
for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
