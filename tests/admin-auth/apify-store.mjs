// Buscadores de repuesto de Apify: validación desde la tienda, cascada con los añadidos y retirada de los caídos.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/apify-store.mjs
// Sin red: la tienda se simula con un `fetch` propio y la cascada se prueba con filas y ejecuciones sintéticas.
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.ADMIN_SECRETS_KEY = 'test-root'; process.env.APIFY_API_BASE = 'https://apify.test';

const { storeItemsFrom, verdictOf, checkActor, findReplacements, queriesFor } = await import('../../apps/web/lib/apifyStore.ts');
const { recipesOf, orderRecipes, retirementCandidates, portalViews, isRetired, RETIRE_AFTER } = await import('../../apps/web/lib/apifyAuto.ts');
const { portalById } = await import('../../apps/web/lib/apifyCatalog.ts');

const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });

// ---- la tienda ----
assert.deepEqual(storeItemsFrom(null), []);
assert.deepEqual(storeItemsFrom({ data: { items: 'x' } }), []);
const items = storeItemsFrom({ data: { items: [
  { username: 'ana', name: 'infojobs-scraper', title: 'InfoJobs Scraper', description: '  Ofertas\n de empleo ', stats: { totalUsers: 120, totalRuns: 900 } },
  { username: 'ana', name: '' }, { name: 'sin-usuario' }, 'basura', { username: 'bad user', name: 'x' },
] } });
assert.equal(items.length, 1, 'un item sin usuario, sin nombre o con nombre inválido se descarta');
assert.equal(items[0].actor, 'ana/infojobs-scraper');
assert.equal(items[0].description, 'Ofertas de empleo');
assert.equal(items[0].users, 120);

// ---- el veredicto: solo «valid» si TODO consta; un hueco no es un sí ----
const base = { actor: 'a/b', exists: true, deprecated: false, buildStatus: 'SUCCEEDED', schemaRead: true, reasons: [] };
assert.equal(verdictOf(base), 'valid');
assert.equal(verdictOf({ ...base, exists: false }), 'invalid');
assert.equal(verdictOf({ ...base, deprecated: true }), 'invalid');
assert.equal(verdictOf({ ...base, buildStatus: 'FAILED' }), 'invalid');
assert.equal(verdictOf({ ...base, schemaRead: false }), 'invalid');
for (const missing of ['exists', 'deprecated', 'buildStatus', 'schemaRead']) assert.equal(verdictOf({ ...base, [missing]: null }), 'unverified', `sin ${missing} no es válido: es «sin verificar»`);

// ---- checkActor contra metadatos simulados ----
const routes = {
  '/v2/acts/ana~ok': { data: { isDeprecated: false } },
  '/v2/acts/ana~ok/builds/default': { data: { status: 'SUCCEEDED', inputSchema: JSON.stringify({ properties: { q: { type: 'string' } } }) } },
  '/v2/acts/ana~old': { data: { isDeprecated: true } },
  '/v2/acts/ana~old/builds/default': { data: { status: 'SUCCEEDED', inputSchema: JSON.stringify({ properties: { q: {} } }) } },
  '/v2/acts/ana~nofield': { data: {} },
  '/v2/acts/ana~nofield/builds/default': { data: { status: 'SUCCEEDED', actorDefinition: { input: { properties: { q: {} } } } } },
  '/v2/acts/ana~failed': { data: { isDeprecated: false } },
  '/v2/acts/ana~failed/builds/default': { data: { status: 'FAILED', inputSchema: JSON.stringify({ properties: { q: {} } }) } },
  '/v2/acts/ana~noschema': { data: { isDeprecated: false } },
  '/v2/acts/ana~noschema/builds/default': { data: { status: 'SUCCEEDED', inputSchema: null } },
};
const calls = [];
const fakeFetch = async target => {
  const path = new URL(String(target)).pathname; calls.push(String(target));
  if (path === '/v2/store') {
    const term = new URL(String(target)).searchParams.get('search') ?? '';
    return term.startsWith('caida') ? json(503) : json(200, { data: { items: [
      { username: 'ana', name: 'ok', title: 'OK', stats: { totalUsers: 10 } }, { username: 'ana', name: 'old', title: 'Old', stats: { totalUsers: 999 } },
      { username: 'ana', name: 'nofield', title: 'Sin campo' }, { username: 'ana', name: 'failed' }, { username: 'ana', name: 'noschema' },
      { username: 'ana', name: 'ghost' }, { username: 'ana', name: 'conocido' },
    ] } });
  }
  return routes[path] ? json(200, routes[path]) : json(404);
};
const v = async actor => verdictOf(await checkActor(actor, { fetchImpl: fakeFetch }));
assert.equal(await v('ana/ok'), 'valid');
assert.equal(await v('ana/old'), 'invalid');
assert.equal(await v('ana/failed'), 'invalid');
assert.equal(await v('ana/noschema'), 'invalid');
assert.equal(await v('ana/ghost'), 'invalid', 'un 404 de la tienda: no existe');
assert.equal(await v('ana/nofield'), 'unverified', 'la tienda no dice si está obsoleto: sin verificar, no válido');
assert.equal(await v('no es un actor'), 'invalid');
const down = await checkActor('ana/ok', { fetchImpl: async () => { throw new Error('red'); } });
assert.equal(verdictOf(down), 'unverified', 'sin red no se afirma nada');
assert.ok(down.reasons.length);
assert.ok(calls.every(url => url.startsWith('https://apify.test/')), 'solo llama a la API configurada');

// ---- findReplacements: excluye los conocidos, valida y ordena ----
assert.deepEqual(queriesFor({ name: 'InfoJobs' }), ['InfoJobs jobs scraper', 'InfoJobs']);
assert.deepEqual(queriesFor({ name: 'Indeed (España)' }), ['Indeed jobs scraper', 'Indeed']);
calls.length = 0;
const found = await findReplacements({ name: 'InfoJobs' }, new Set(['ana/conocido']), { fetchImpl: fakeFetch, maxChecks: 6 });
assert.ok(!found.candidates.some(c => c.actor === 'ana/conocido'), 'los que ya están no se proponen');
assert.equal(found.candidates[0].verdict, 'valid', 'los validados primero');
assert.equal(found.candidates[0].actor, 'ana/ok');
assert.ok(found.candidates.at(-1).verdict !== 'valid');
assert.equal(found.truncated, false);
const few = await findReplacements({ name: 'InfoJobs' }, new Set(), { fetchImpl: fakeFetch, maxChecks: 2 });
assert.equal(few.candidates.length, 2, 'la validación está acotada');
assert.equal(few.truncated, true, 'y se declara que quedaron sin comprobar');
const noStore = await findReplacements({ name: 'caida' }, new Set(), { fetchImpl: fakeFetch });
assert.equal(noStore.candidates.length, 0);
assert.match(noStore.error ?? '', /HTTP 503/, 'una tienda caída se declara, no se presenta como «sin repuestos»');

// ---- la cascada con los añadidos y los retirados ----
const indeed = portalById('indeed');
const row = (actor, extra = {}) => ({ id: `id-${actor}`, label: actor, actor, source: indeed.source, schedule_daily: false, ...extra });
const catalogRows = indeed.recipes.map(r => row(r.actor));
assert.deepEqual(recipesOf(indeed, catalogRows).map(r => r.actor), indeed.recipes.map(r => r.actor), 'sin cambios, el catálogo manda');
const added = row('ana/nuevo', { label: 'Nuevo de la tienda' });
assert.equal(recipesOf(indeed, [...catalogRows, added]).at(-1).actor, 'ana/nuevo', 'un actor añadido desde la tienda entra en la cascada');
assert.equal(recipesOf(indeed, [...catalogRows, added]).at(-1).name, 'Nuevo de la tienda');
const withRetired = catalogRows.map((r, i) => i === 0 ? { ...r, status: 'inactive' } : r);
assert.ok(isRetired(withRetired[0]));
assert.ok(!recipesOf(indeed, withRetired).some(r => r.actor === indeed.recipes[0].actor), 'un retirado sale de la cascada');
assert.ok(!recipesOf(indeed, [...catalogRows, { ...added, status: 'inactive' }]).some(r => r.actor === 'ana/nuevo'), 'un añadido retirado tampoco cuenta');
assert.equal(recipesOf(indeed, [row('otro/portal', { source: 'apify-otro' })]).some(r => r.actor === 'otro/portal'), false, 'los de otro portal no se mezclan');

const now = Date.parse('2026-11-21T12:00:00Z');
const run = (actor, status, hoursAgo, extra = {}) => ({ id: `r-${actor}-${hoursAgo}`, actor_id: `id-${actor}`, run_id: `x${hoursAgo}${actor}`, status, started_at: new Date(now - hoursAgo * 3600e3).toISOString(), finished_at: new Date(now - hoursAgo * 3600e3 + 60e3).toISOString(), harvested: 0, items_total: 0, error: null, ...extra });
const first = indeed.recipes[0].actor;
const failedRuns = [run(first, 'FAILED', 1), run(first, 'FAILED', 30), run(first, 'FAILED', 60)];
assert.deepEqual(orderRecipes(indeed, catalogRows, failedRuns, now).at(-1).actor, first, 'el que falló va al final aunque siga activo');
assert.equal(RETIRE_AFTER, 3);
assert.deepEqual(retirementCandidates(indeed, catalogRows, failedRuns, now).map(a => a.actor), [first], 'tres fallos seguidos: se retira');
assert.deepEqual(retirementCandidates(indeed, catalogRows, failedRuns.slice(0, 2), now), [], 'con dos fallos todavía no');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'FAILED', 1), run(first, 'SUCCEEDED', 30, { harvested: 12 }), run(first, 'FAILED', 60), run(first, 'FAILED', 90)], now), [], 'una ejecución buena en la ventana lo salva');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'SUCCEEDED', 1, { harvested: 5 }), run(first, 'FAILED', 30), run(first, 'FAILED', 60)], now), [], 'la más reciente trajo ofertas: no son tres fallos seguidos');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'FAILED', 24 * 20), run(first, 'FAILED', 24 * 21), run(first, 'FAILED', 24 * 22)], now), [], 'fuera de la ventana de 14 días no cuenta');
// Un fallo con 0 ofertas también cuenta como fallo (terminó bien pero no trajo nada).
assert.equal(retirementCandidates(indeed, catalogRows, [run(first, 'SUCCEEDED', 1), run(first, 'SUCCEEDED', 30), run(first, 'SUCCEEDED', 60)], now).length, 1, 'tres ejecuciones sin ofertas son tres fallos');
// Nunca se retira el último: si todos fallan, se queda al menos uno.
const allFailed = indeed.recipes.flatMap(r => [run(r.actor, 'FAILED', 1), run(r.actor, 'FAILED', 30), run(r.actor, 'FAILED', 60)]);
const retiring = retirementCandidates(indeed, catalogRows, allFailed, now);
assert.equal(retiring.length, indeed.recipes.length - 1, 'siempre queda un buscador');
const single = portalById('infojobs');
assert.deepEqual(retirementCandidates(single, [{ ...row(single.recipes[0].actor), source: single.source }], [run(single.recipes[0].actor, 'FAILED', 1), run(single.recipes[0].actor, 'FAILED', 30), run(single.recipes[0].actor, 'FAILED', 60)], now), [], 'un portal con un solo buscador no retira nada');

// ---- la vista del panel ----
const views = portalViews([...catalogRows, { ...added }], [], now, null);
const indeedView = views.find(p => p.id === 'indeed');
assert.equal(indeedView.needs_more, false);
assert.ok(indeedView.recipes.some(r => r.actor === 'ana/nuevo' && r.added === true));
const retiredView = portalViews(withRetired, [], now, null).find(p => p.id === 'indeed');
assert.equal(retiredView.retired.length, 1, 'el retirado se enseña para poder reactivarlo');
assert.equal(retiredView.recipes.length, indeed.recipes.length - 1);
const infojobsView = views.find(p => p.id === 'infojobs');
assert.equal(infojobsView.needs_more, true, 'un portal con un solo buscador avisa de que no hay repuesto');
assert.equal(views.find(p => p.id === 'multi').needs_more, false, 'el multi-portal es un solo buscador por diseño');

console.log('PASS  apify-store: validación estricta desde la tienda, cascada con añadidos y retirada de los caídos');
