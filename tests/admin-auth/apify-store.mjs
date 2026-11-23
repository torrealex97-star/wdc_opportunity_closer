// Buscadores de repuesto de Apify: validación desde la tienda, cascada con los añadidos y retirada de los caídos.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/apify-store.mjs
// Sin red: la tienda se simula con un `fetch` propio y la cascada se prueba con filas y ejecuciones sintéticas.
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.ADMIN_SECRETS_KEY = 'test-root'; process.env.APIFY_API_BASE = 'https://apify.test';

const { storeItemsFrom, verdictOf, checkActor, findReplacements, queriesFor, compatibilityOf, normalizeActor } = await import('../../apps/web/lib/apifyStore.ts');
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
// Los otros buscadores del portal siguen sanos: el que falla solo es un actor roto, no una caída del proveedor.
const healthyOthers = indeed.recipes.slice(1).map(r => run(r.actor, 'SUCCEEDED', 2, { harvested: 20 }));
assert.deepEqual(orderRecipes(indeed, catalogRows, [...failedRuns, ...healthyOthers], now).at(-1).actor, first, 'el que falló va al final aunque siga activo');
assert.equal(RETIRE_AFTER, 3);
assert.deepEqual(retirementCandidates(indeed, catalogRows, [...failedRuns, ...healthyOthers], now).map(a => a.actor), [first], 'tres fallos en días distintos con los demás sanos: se retira');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [...failedRuns.slice(0, 2), ...healthyOthers], now), [], 'con dos fallos todavía no');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'FAILED', 1), run(first, 'SUCCEEDED', 30, { harvested: 12 }), run(first, 'FAILED', 60), run(first, 'FAILED', 90), ...healthyOthers], now), [], 'una ejecución buena en la ventana lo salva');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'SUCCEEDED', 1, { harvested: 5 }), run(first, 'FAILED', 30), run(first, 'FAILED', 60), ...healthyOthers], now), [], 'la más reciente trajo ofertas: no son tres fallos seguidos');
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'FAILED', 24 * 20), run(first, 'FAILED', 24 * 21), run(first, 'FAILED', 24 * 22), ...healthyOthers], now), [], 'fuera de la ventana de 14 días no cuenta');
assert.equal(retirementCandidates(indeed, catalogRows, [run(first, 'SUCCEEDED', 1), run(first, 'SUCCEEDED', 30), run(first, 'SUCCEEDED', 60), ...healthyOthers], now).length, 1, 'tres ejecuciones sin ofertas, en días distintos, son tres fallos');
// Un mal día no retira a nadie: tres fallos en la misma tarde (p. ej. 5xx de Apify) no bastan.
assert.deepEqual(retirementCandidates(indeed, catalogRows, [run(first, 'FAILED', 1), run(first, 'FAILED', 2), run(first, 'FAILED', 3), ...healthyOthers], now), [], 'tres fallos en la misma jornada no retiran');
// Caída del proveedor: si TODOS fallaron en su última ejecución no se retira ninguno (no es culpa de un actor).
const allFailed = indeed.recipes.flatMap(r => [run(r.actor, 'FAILED', 1), run(r.actor, 'FAILED', 30), run(r.actor, 'FAILED', 60)]);
assert.deepEqual(retirementCandidates(indeed, catalogRows, allFailed, now), [], 'todos caídos a la vez = caída del proveedor: no se retira nadie');
// Con solo dos buscadores y uno sano, el roto sí se retira y el sano queda (nunca se retira el último).
const two = [row(indeed.recipes[0].actor), row(indeed.recipes[1].actor)];
const twoRetired = retirementCandidates({ ...indeed, recipes: indeed.recipes.slice(0, 2) }, two, [...failedRuns, run(indeed.recipes[1].actor, 'SUCCEEDED', 2, { harvested: 9 })], now);
assert.deepEqual(twoRetired.map(a => a.actor), [first]);
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

// ---- `a/b` y `a~b` son el mismo actor; el esquema tiene que encajar con el portal ----
assert.equal(normalizeActor('Ana~Infojobs-Pro'), 'ana/infojobs-pro');
assert.equal(normalizeActor(' ana/infojobs-pro '), 'ana/infojobs-pro');
const tilde = recipesOf(indeed, [row('Misceres~Indeed-Scraper'), ...indeed.recipes.slice(1).map(r => row(r.actor))]);
assert.equal(tilde.length, indeed.recipes.length, 'un actor del catálogo guardado con ~ y otras mayúsculas no se duplica como «añadido»');
const fitOk = compatibilityOf({ schema: { properties: { searchTerm: { type: 'string' }, maxItems: { type: 'integer' } }, required: ['searchTerm'] } }, { maxItems: 100, query: 'closer' });
assert.equal(fitOk.ok, true, 'pide un campo que la app sabe rellenar (búsqueda)');
const fitBad = compatibilityOf({ schema: { properties: { startUrls: { type: 'array' } }, required: ['startUrls'] } }, { maxItems: 100, query: 'closer' });
assert.equal(fitBad.ok, false); assert.deepEqual(fitBad.missing, ['startUrls'], 'un obligatorio que la app no rellena = no encaja');
assert.equal(compatibilityOf({}, { maxItems: 100 }).ok, false, 'sin esquema no se afirma encaje');
assert.equal(compatibilityOf({ schema: { properties: { query: {}, locale: {} }, required: [] } }, { maxItems: 100, inputTemplate: { query: '{{query}}', locale: 'es' } }).ok, true, 'con plantilla del portal, sus campos existen en el esquema');
assert.deepEqual(compatibilityOf({ schema: { properties: { query: {} }, required: [] } }, { maxItems: 100, inputTemplate: { query: '{{query}}', country: 'ES' } }).missing, ['country']);

// ---- la búsqueda en la tienda: reloj compartido, fallo parcial y encaje ----
const slowFetch = async target => { await new Promise(r => setTimeout(r, 30)); return fakeFetch(target); };
const rushed = await findReplacements({ name: 'InfoJobs', maxItems: 100 }, new Set(), { fetchImpl: slowFetch, deadline: Date.now() + 500 });
assert.equal(rushed.candidates.length, 0, 'con el reloj casi agotado no se valida nada');
assert.equal(rushed.truncated, true, 'y se declara el corte');
assert.equal(rushed.allFailed, false, 'un corte por tiempo no es «la tienda no responde»');
const partialFetch = async target => {
  const u = new URL(String(target));
  return u.pathname === '/v2/store' && u.searchParams.get('search') === 'InfoJobs' ? json(503) : fakeFetch(target);
};
const partial = await findReplacements({ name: 'InfoJobs', maxItems: 100 }, new Set(), { fetchImpl: partialFetch });
assert.equal(partial.allFailed, false, 'una de dos consultas respondió: no es un fallo total');
assert.match(partial.error ?? '', /HTTP 503/, 'el fallo parcial se declara como aviso');
assert.ok(partial.candidates.length > 0, 'y se enseña lo encontrado');
assert.equal(noStore.allFailed, true, 'si TODAS las consultas fallan, sí es un fallo total');
const tildeKnown = await findReplacements({ name: 'InfoJobs', maxItems: 100 }, new Set(['ANA~ok']), { fetchImpl: fakeFetch });
assert.ok(!tildeKnown.candidates.some(c => c.actor === 'ana/ok'), '`ANA~ok` ya conocido excluye a `ana/ok`');
const incompat = await findReplacements({ name: 'InfoJobs', maxItems: 100 }, new Set(), { fetchImpl: async target => {
  const path = new URL(String(target)).pathname;
  if (path === '/v2/store') return json(200, { data: { items: [{ username: 'ana', name: 'urls-only', title: 'Solo URLs' }] } });
  if (path === '/v2/acts/ana~urls-only') return json(200, { data: { isDeprecated: false } });
  return json(200, { data: { status: 'SUCCEEDED', inputSchema: JSON.stringify({ properties: { startUrls: { type: 'array' } }, required: ['startUrls'] }) } });
} });
assert.equal(incompat.candidates[0].verdict, 'invalid', 'un actor sano que pide URLs no encaja con una búsqueda por texto');
assert.match(incompat.candidates[0].reasons.join(' '), /startUrls/);

console.log('PASS  apify-store: validación estricta desde la tienda, cascada con añadidos y retirada de los caídos');
