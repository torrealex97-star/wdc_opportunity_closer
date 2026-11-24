// Control total de fuentes (2026-11-24): cada fuente cae en un estado medido; lo que no cualifica se marca «a trabajar» con causa, siguiente paso y dueño.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sourcecontrol.mjs
import assert from 'node:assert/strict';
const { classify, summarize, BLOCKED, REASONS } = await import('../../apps/web/lib/sourceControl.ts');
let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const base = (over = {}) => ({ source: 's', name: 'S', kind: 'pago', health: { source: 's', state: 'conectada', cause: 'ok', next: 'nada' }, seen7: 0, approved7: 0, engine: null, ...over });
const eng = (over = {}) => ({ catalog: 10, reviewed: 5, eligible: 0, selected: 0, run_status: 'completed', cause: null, ...over });

await step('direcciones a vigilar: con ≥1 activa Facebook/Skool/Telegram dejan de ser «necesita dato»; sin ellas o sin poder leerlas se dice y se señala la pantalla', () => {
  for (const code of ['apify-facebook', 'apify-skool', 'apify-telegram']) {
    const none = classify(base({ source: code, targets: 0 })); assert.equal(none.state, 'necesita_dato'); assert.equal(none.owner, 'propietario'); assert.match(none.next, /Direcciones a vigilar/);
    const unread = classify(base({ source: code, targets: null })); assert.equal(unread.state, 'necesita_dato'); assert.match(unread.cause, /no se pudieron leer/i, 'sin poder leer no se afirma que falten');
    const some = classify(base({ source: code, targets: 2 })); assert.equal(some.state, 'sin_recoger', 'con direcciones y sin ofertas: conectada sin recoger'); assert.equal(some.owner, 'claude'); assert.match(some.cause, /2 direcciones/);
    const seen = classify(base({ source: code, targets: 2, seen7: 5, approved7: 0 })); assert.equal(seen.state, 'recoge_sin_cualificar', 'recoge y no cualifica: sigue el camino normal');
  }
  assert.equal(classify(base({ source: 'apify-reddit', targets: 3 })).state, 'sin_via', 'las direcciones no desbloquean fuentes que no las usan');
});

await step('con ofertas cualificadas en la ventana, la fuente está hecha', () => {
  const r = classify(base({ seen7: 40, approved7: 3 })); assert.equal(r.state, 'cualificadas'); assert.equal(r.done, true); assert.equal(r.owner, null);
});
await step('fuente del motor: cualificadas = elegibles del motor, recogidas = su catálogo', () => {
  const r = classify(base({ engine: eng({ catalog: 2791, eligible: 124 }) })); assert.equal(r.state, 'cualificadas'); assert.equal(r.collected, 2791); assert.equal(r.qualified, 124);
});
await step('recoge pero no cualifica: «a trabajar» para Claude, con qué mirar', () => {
  const r = classify(base({ engine: eng({ catalog: 4915, eligible: 0 }) })); assert.equal(r.state, 'recoge_sin_cualificar'); assert.equal(r.owner, 'claude'); assert.equal(r.done, false); assert.match(r.next, /regla la descarta/);
});
await step('conectada pero sin recoger: no es «bien», se marca a trabajar', () => {
  const r = classify(base({ seen7: 0, approved7: 0 })); assert.equal(r.state, 'sin_recoger'); assert.equal(r.done, false); assert.match(r.cause, /conectada pero no ha recogido/);
});
await step('rota (HTTP 410/429 del motor, Apify fallando) es «rota» aunque tuviera catálogo', () => {
  const r = classify(base({ engine: eng({ catalog: 95 }), health: { source: 's', state: 'mal_conectada', cause: 'El motor la intentó y falló: HTTP 429.', next: 'x' } })); assert.equal(r.state, 'rota'); assert.match(r.cause, /429/);
});
await step('sin clave = lo necesita el propietario; sin vía = Claude; bloqueadas conocidas con su motivo y dueño', () => {
  assert.equal(classify(base({ health: { source: 's', state: 'sin_clave', cause: 'Falta clave', next: 'Guardarla' } })).owner, 'propietario');
  assert.equal(classify(base({ health: { source: 's', state: 'sin_via', cause: 'Sin vía', next: 'Buscar' } })).owner, 'claude');
  for (const code of ['apify-facebook', 'apify-skool', 'apify-telegram']) { const r = classify(base({ source: code })); assert.equal(r.state, 'necesita_dato'); assert.equal(r.owner, 'propietario'); assert.ok(BLOCKED[code].why.length > 15); }
  assert.equal(classify(base({ source: 'apify-reddit' })).state, 'sin_via');
  assert.equal(classify(base({ source: 'apify-facebook', seen7: 5, approved7: 2 })).state, 'cualificadas', 'si da ofertas cualificadas deja de estar bloqueada');
});
await step('un dato que no se pudo leer NO es 0: se declara, no se da por buena', () => {
  const r = classify(base({ seen7: null, approved7: null })); assert.equal(r.state, 'sin_recoger'); assert.match(r.cause, /No se pudo leer/); assert.equal(r.collected, null);
});
await step('recoge sin cualificar con motivos de descarte: la causa nombra los tres principales y el siguiente paso arregla el primero', () => {
  const r = classify(base({ seen7: 120, approved7: 0, reasons: [{ why: 'sin_perfil', n: 70 }, { why: 'idioma_dudoso', n: 30 }, { why: 'score_bajo', n: 10 }, { why: 'enlace_cerrado', n: 3 }] }));
  assert.equal(r.state, 'recoge_sin_cualificar'); assert.deepEqual(r.reasons.map(x => x.why), ['sin_perfil', 'idioma_dudoso', 'score_bajo'], 'solo los tres primeros, por volumen');
  assert.match(r.cause, /no es de closer, setter ni cold calling \(70\), idioma dudoso \(30\), puntuación baja \(10\)/); assert.equal(r.next, REASONS.sin_perfil.next);
});
await step('borradores sin juzgar: se dicen y el paso es juzgarlas (la IA en «live» o a mano), no tocar la búsqueda', () => {
  const r = classify(base({ seen7: 60, approved7: 0, drafts7: 55, reasons: [] }));
  assert.match(r.cause, /55 siguen en borrador sin juzgar/); assert.match(r.next, /IA a «live»/); assert.equal(r.drafts, 55);
});
await step('fuente del motor sin elegibles: dice cuántas revisó el motor; los motivos desconocidos no rompen y salen con su código', () => {
  const r = classify(base({ engine: eng({ catalog: 300, reviewed: 100, eligible: 0 }) })); assert.match(r.cause, /el motor revisó 100 y ninguna cumple/);
  const odd = classify(base({ seen7: 5, approved7: 0, reasons: [{ why: 'motivo_nuevo', n: 5 }] })); assert.match(odd.cause, /motivo_nuevo \(5\)/); assert.match(odd.next, /Ver por qué/);
});
await step('resumen: titular «X de N», conteos por estado y «a trabajar» ordenado (rotas primero, luego por volumen)', () => {
  const s = summarize([
    base({ source: 'a', name: 'A', seen7: 9, approved7: 2 }),
    base({ source: 'b', name: 'B', engine: eng({ catalog: 50 }) }),
    base({ source: 'c', name: 'C', engine: eng({ catalog: 5 }) }),
    base({ source: 'd', name: 'D', health: { source: 'd', state: 'mal_conectada', cause: 'falla', next: 'x' } }),
    base({ source: 'e', name: 'E' }),
  ]);
  assert.equal(s.headline, '1 de 5 fuentes dan ofertas cualificadas.'); assert.equal(s.total, 5); assert.equal(s.qualified, 1);
  assert.deepEqual(s.todo.map(i => i.source), ['d', 'b', 'c', 'e']); assert.deepEqual(s.counts, { cualificadas: 1, recoge_sin_cualificar: 2, sin_recoger: 1, rota: 1, necesita_dato: 0, sin_via: 0 });
  assert.equal(summarize([]).headline, 'No hay fuentes que medir.');
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
process.exit(failed ? 1 : 0);
