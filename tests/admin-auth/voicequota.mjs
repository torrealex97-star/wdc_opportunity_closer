// Topes de voz y catálogo de proveedores (2026-11-24): máximo 10 min por alumna y día, tope global, huecos declarados.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voicequota.mjs
import assert from 'node:assert/strict';
import { DAILY_VOICE_SECONDS_MAX, dailyVoiceSeconds, globalVoiceUsd, voiceGate } from '../../apps/web/lib/voiceQuota.ts';
import { VOICE_PROVIDERS, estimateUsd, providerById } from '../../apps/web/lib/voiceProvider.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

step('tope diario: 10 minutos; el entorno solo puede bajarlo, nunca subirlo', () => {
  assert.equal(DAILY_VOICE_SECONDS_MAX, 600); assert.equal(dailyVoiceSeconds({}), 600);
  assert.equal(dailyVoiceSeconds({ VOICE_DAILY_MINUTES: '5' }), 300); assert.equal(dailyVoiceSeconds({ VOICE_DAILY_MINUTES: '30' }), 600);
  for (const bad of ['', 'abc', '0', '-3']) assert.equal(dailyVoiceSeconds({ VOICE_DAILY_MINUTES: bad }), 600, bad);
});
step('con consumo bajo y gasto bajo se abre y dice cuánto queda', () => {
  assert.deepEqual(voiceGate({ usedSecondsToday: 120, spentUsdMonth: 1 }, {}), { allowed: true, remainingSeconds: 480 });
});
step('al llegar a los 10 minutos del día se corta, aunque el gasto global sea cero', () => {
  assert.deepEqual(voiceGate({ usedSecondsToday: 600, spentUsdMonth: 0 }, {}), { allowed: false, reason: 'daily_cap', remainingSeconds: 0 });
  assert.equal(voiceGate({ usedSecondsToday: 9999, spentUsdMonth: 0 }, {}).remainingSeconds, 0);
});
step('tope global mensual: con la estimación de la sesión que se pasaría, no se abre', () => {
  assert.equal(globalVoiceUsd({}), 10); assert.equal(globalVoiceUsd({ VOICE_MONTHLY_USD: '25,5' }), 25.5);
  assert.equal(voiceGate({ usedSecondsToday: 0, spentUsdMonth: 9.9, sessionEstimateUsd: 0.5 }, {}).reason, 'global_cap');
  assert.equal(voiceGate({ usedSecondsToday: 0, spentUsdMonth: 9.9, sessionEstimateUsd: 0.05 }, {}).allowed, true);
});
step('un consumo o gasto que no se pudo leer NO abre la voz (un hueco no es un cero)', () => {
  assert.equal(voiceGate({ usedSecondsToday: null, spentUsdMonth: 0 }, {}).reason, 'usage_unreadable');
  assert.equal(voiceGate({ usedSecondsToday: 0, spentUsdMonth: null }, {}).allowed, false);
});
step('catálogo: cuatro candidatos, rangos coherentes, estimación en el peor caso y desconocidos a null', () => {
  assert.equal(VOICE_PROVIDERS.length, 4);
  for (const p of VOICE_PROVIDERS) { assert.ok(p.usdPerMinute.low > 0 && p.usdPerMinute.low <= p.usdPerMinute.high, p.id); assert.match(p.source, /^https:\/\//); assert.ok(p.zeroRetention.length > 10); }
  assert.equal(estimateUsd('elevenlabs_agents', 600), 1.6); assert.equal(estimateUsd('openai_realtime_mini', 600), 0.5);
  assert.equal(estimateUsd('no-existe', 60), null); assert.equal(estimateUsd('deepgram_agent', -1), null); assert.equal(providerById('deepgram_agent')?.usdPerMinute.high, 0.075);
  const cheapest = [...VOICE_PROVIDERS].sort((a, b) => a.usdPerMinute.high - b.usdPerMinute.high)[0];
  assert.equal(cheapest.id, 'openai_realtime_mini');
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
