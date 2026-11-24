// Cascada de proveedores de voz (2026-11-24): el más barato con clave y sano; pago, clave o errores pasan al siguiente; un hueco no elige a ciegas.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voicecascade.mjs
import assert from 'node:assert/strict';
import { ERROR_PAUSE_MS, KEY_PAUSE_MS, cascadeOrder, planCascade } from '../../apps/web/lib/voiceCascade.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const NOW = new Date('2026-11-24T12:00:00Z');
const ago = ms => new Date(NOW.getTime() - ms).toISOString();
const all = new Set(['openai', 'deepgram', 'elevenlabs']);
const plan = (over = {}) => planCascade({ configured: all, events: [], now: NOW, ...over });

step('orden por coste: mini de OpenAI, Deepgram, OpenAI completo y ElevenLabs', () => {
  assert.deepEqual(cascadeOrder(), ['openai_realtime_mini', 'deepgram_agent', 'openai_realtime', 'elevenlabs_agents']);
});
step('con todas las claves se elige la más barata; sin ninguna clave no se elige nada y se dice por qué', () => {
  assert.equal(plan().chosen, 'openai_realtime_mini');
  const none = plan({ configured: new Set() }); assert.equal(none.chosen, null); assert.ok(none.order.every(e => e.state === 'sin_clave'));
});
step('solo ElevenLabs con clave: se usa ElevenLabs aunque sea la más cara (basta con añadir una API)', () => {
  const p = plan({ configured: new Set(['elevenlabs']) }); assert.equal(p.chosen, 'elevenlabs_agents');
  assert.equal(p.order.find(e => e.id === 'openai_realtime_mini').state, 'sin_clave');
});
step('un pago rechazado pausa la clave 24 h (los dos modelos de OpenAI) y se sigue con Deepgram', () => {
  const p = plan({ events: [{ provider: 'openai_realtime_mini', kind: 'payment', created_at: ago(60_000) }] });
  assert.equal(p.chosen, 'deepgram_agent');
  for (const id of ['openai_realtime_mini', 'openai_realtime']) assert.equal(p.order.find(e => e.id === id).state, 'pausado_pago');
  assert.equal(p.order.find(e => e.id === 'openai_realtime_mini').until, new Date(NOW.getTime() - 60_000 + KEY_PAUSE_MS).toISOString());
});
step('una clave rechazada también pausa; pasadas 24 h se vuelve a probar', () => {
  assert.equal(plan({ events: [{ provider: 'deepgram_agent', kind: 'auth', created_at: ago(1000) }, { provider: 'openai_realtime_mini', kind: 'payment', created_at: ago(2000) }] }).chosen, 'elevenlabs_agents', 'OpenAI (pago) y Deepgram (clave) pausados: queda ElevenLabs');
  assert.equal(plan({ events: [{ provider: 'openai_realtime_mini', kind: 'payment', created_at: ago(KEY_PAUSE_MS + 1000) }] }).chosen, 'openai_realtime_mini');
});
step('guardar una clave NUEVA después de la incidencia la anula; un «ok» posterior también', () => {
  const ev = [{ provider: 'openai_realtime_mini', kind: 'payment', created_at: ago(60_000) }];
  assert.equal(plan({ events: ev, keyUpdatedAt: { openai: ago(10_000) } }).chosen, 'openai_realtime_mini');
  assert.equal(plan({ events: ev, keyUpdatedAt: { openai: ago(120_000) } }).chosen, 'deepgram_agent', 'una clave anterior a la incidencia no la borra');
  assert.equal(plan({ events: [{ provider: 'openai_realtime_mini', kind: 'ok', created_at: ago(1000) }, ...ev] }).chosen, 'openai_realtime_mini');
});
step('dos errores seguidos apartan 15 min SOLO a ese modelo; uno solo, o con un «ok» en medio, no', () => {
  const e = (kind, ms) => ({ provider: 'openai_realtime_mini', kind, created_at: ago(ms) });
  const p = plan({ events: [e('error', 1000), e('error', 2000)] });
  assert.equal(p.order[0].state, 'pausado_error'); assert.equal(p.chosen, 'deepgram_agent'); assert.equal(p.order.find(x => x.id === 'openai_realtime').state, 'activo');
  assert.equal(plan({ events: [e('error', 1000)] }).chosen, 'openai_realtime_mini');
  assert.equal(plan({ events: [e('error', 1000), e('ok', 2000), e('error', 3000)] }).chosen, 'openai_realtime_mini');
  assert.equal(plan({ events: [e('error', ERROR_PAUSE_MS + 5000), e('error', ERROR_PAUSE_MS + 6000)] }).chosen, 'openai_realtime_mini', 'pasados 15 min se reintenta');
});
step('todos pausados: no hay elegido (503 para el servicio); claves ilegibles: «sin_leer», no se elige a ciegas', () => {
  const ev = [{ provider: 'openai_realtime_mini', kind: 'payment', created_at: ago(1) }, { provider: 'deepgram_agent', kind: 'payment', created_at: ago(1) }, { provider: 'elevenlabs_agents', kind: 'auth', created_at: ago(1) }];
  assert.equal(plan({ events: ev }).chosen, null);
  const blind = plan({ configured: null }); assert.equal(blind.chosen, null); assert.ok(blind.order.every(e => e.state === 'sin_leer'));
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
