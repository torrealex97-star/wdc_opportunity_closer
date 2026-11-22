// «Probar ruta» recoge de verdad: qué cuenta como recogida y cuántas vías se prueban. Lógica pura, sin red.
// node --experimental-strip-types tests/admin-auth/probecascade.mjs
import assert from 'node:assert/strict';
const { isCollected, planAttempts, attemptMessage, summarize, MAX_PROBE_ATTEMPTS } = await import('../../apps/web/lib/probeCascade.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const route = (id, provider) => ({ id, provider, label: id });

await step('recoge = ofertas guardadas, estado real del motor con catálogo o búsqueda de Apify lanzada; 0 guardadas no cuenta', () => {
  assert.equal(isCollected(true, { accepted: 2 }), true);
  assert.equal(isCollected(true, { accepted: 0 }), false, 'una respuesta correcta sin ofertas no es recoger');
  assert.equal(isCollected(true, { accepted: 0, engine: { catalog: 10 } }), true);
  assert.equal(isCollected(true, { accepted: 0, async: true }), true);
  assert.equal(isCollected(false, { accepted: 5 }), false, 'un error nunca cuenta');
  assert.equal(isCollected(true, {}), false);
});

await step('como máximo 3 vías por pulsación y el Unlocker solo si es la primera (necesita una URL concreta)', () => {
  const ready = [route('a', 'brightdata'), route('b', 'jsearch'), route('c', 'serpapi'), route('d', 'apify')];
  assert.deepEqual(planAttempts(ready).map(r => r.id), ['a', 'b', 'c']); assert.equal(MAX_PROBE_ATTEMPTS, 3);
  assert.deepEqual(planAttempts([route('u', 'unlocker'), route('b', 'jsearch')]).map(r => r.id), ['u', 'b'], 'primera: entra');
  assert.deepEqual(planAttempts([route('a', 'brightdata'), route('u', 'unlocker'), route('b', 'jsearch')]).map(r => r.id), ['a', 'b'], 'no primera: se salta');
  assert.deepEqual(planAttempts([]), []);
});

await step('cada intento dice por qué se pasó a la siguiente y el resumen declara el coste y lo que queda', () => {
  assert.equal(attemptMessage(true, { note: 'Bright Data devolvió 0 resultados; 0 guardada(s).', accepted: 0 }), 'Bright Data devolvió 0 resultados; 0 guardada(s). Sin ofertas nuevas.');
  assert.equal(attemptMessage(true, { note: '2 guardada(s).', accepted: 2 }), '2 guardada(s).');
  assert.equal(attemptMessage(false, { detail: 'Tope mensual agotado' }), 'Tope mensual agotado');
  assert.equal(attemptMessage(false, {}), 'La prueba falló.');
  const usd = v => `${v} US$`;
  assert.equal(summarize(['A: 0 guardadas', 'B: 3 guardadas'], true, 2, 4, 0.004, usd), 'A: 0 guardadas → B: 3 guardadas Coste: 0.004 US$.');
  assert.match(summarize(['A: x'], false, 3, 5, 0, usd), /quedan más en la lista/);
  assert.match(summarize(['A: x'], false, 1, 1, 0, usd), /Ninguna vía lista recogió ofertas ahora/);
  assert.doesNotMatch(summarize(['A: x'], false, 1, 1, 0, usd), /Coste/, 'sin gasto no se escribe coste');
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
