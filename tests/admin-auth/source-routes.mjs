// Rutas por fuente, contrato de Bright Data, extractor JobPosting y cascada. Sin red y sin claves:
// el `fetch` de Bright Data se simula y los fixtures usan la forma documentada. Comprueba, sobre todo,
// que sin clave o sin tope NO se hace ninguna llamada de pago y que JobSpy va al final.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routesForSource, routesForCatalog, planCascade, runCascade, routeReadiness, groupForSource, hasFreeOperationalRoute, orderRoutes, unlockerProviderFor, AGENT_GAP_FILL } from '../../apps/web/lib/sourceRoutes.ts';
import { BRIGHTDATA_USD_PER_REQUEST, brightDataSource, parseBrightDataSecret, serpJobs, jobsFromPayload, googleJobsUrl, zonesFromPayload, pickBrightDataZones, listZones, resolveBrightDataConfig, serpProbeRequest, unwrapPayload } from '../../apps/web/lib/providers/brightdata.ts';
import { PROVIDER_METERS, spendNote, costFromNote, spentFromNotes, canSpend } from '../../apps/web/lib/providerBudget.ts';
import { extractJobPostings } from '../../apps/web/lib/jobPosting.ts';
import { setupFor } from '../../apps/web/lib/sourceSetup.ts';
import { COMPANY_WATCHLIST } from '../../apps/web/lib/companyWatchlist.ts';

const catalog = JSON.parse(readFileSync(new URL('../../apps/web/lib/sourceCatalog.json', import.meta.url), 'utf8'));
const entry = code => catalog.find(item => item.code === code);
const state = (overrides = {}) => ({ keys: new Set(), paused: false, budget: {}, proxiesHealthy: false, ...overrides });

// 1. Orden por coste y cobertura: toda fuente tiene al menos una vía y JobSpy es la última.
const bySource = routesForCatalog(catalog);
for (const item of catalog) {
  const routes = bySource.get(item.code) ?? [];
  assert.ok(routes.length > 0, `${item.code} sin ninguna ruta`);
  assert.ok(routes.every(route => route.source === item.code), `${item.code}: ruta de otra fuente`);
  for (let i = 1; i < routes.length; i++) assert.ok(routes[i].stage >= routes[i - 1].stage, `${item.code}: rutas desordenadas`);
}
const indeed = routesForSource(entry('indeed')).map(route => route.provider);
assert.deepEqual(indeed.slice(0, 3), ['brightdata', 'serpapi', 'apify'], 'Indeed: Bright Data antes que SerpApi y Apify');
assert.ok(indeed.indexOf('jobspy') > indeed.indexOf('apify'), 'JobSpy va después de Apify');
assert.equal(indeed.at(-1), 'jobspy', 'JobSpy es la última vía de Indeed');
const infojobsProviders = routesForSource(entry('infojobs')).map(route => route.provider);
assert.deepEqual(infojobsProviders.slice(0, 3), ['official', 'brightdata', 'serpapi'], 'InfoJobs: API oficial, Bright Data y SerpApi');
assert.equal(infojobsProviders.at(-1), 'apify', 'InfoJobs cierra con Apify; no tiene JobSpy');
assert.ok(routesForSource(entry('infojobs')).some(route => route.provider === 'official'), 'InfoJobs conserva su API oficial');
assert.equal(routesForSource(entry('remotejobs'))[0].evidence, 'bloqueado', 'un feed muerto no se presenta operativo');
assert.equal(AGENT_GAP_FILL.evidence, 'no_disponible');

// 2. Sin clave no hay conexión; sin tope legible tampoco se gasta.
const brightdataRoute = routesForSource(entry('infojobs')).find(route => route.provider === 'brightdata');
assert.equal(routeReadiness(brightdataRoute, state()).ok, false);
assert.match(routeReadiness(brightdataRoute, state()).reason, /Sin clave/);
assert.equal(routeReadiness(brightdataRoute, state({ keys: new Set(['brightdata']), budget: { brightdata: null } })).ok, false, 'sin gasto legible no se lanza');
assert.equal(routeReadiness(brightdataRoute, state({ keys: new Set(['brightdata']), budget: { brightdata: 4.99 } })).ok, true);
assert.equal(routeReadiness(brightdataRoute, state({ keys: new Set(['brightdata']), budget: { brightdata: 0 } })).ok, false, 'tope agotado');
const jobspyRoute = routesForSource(entry('indeed')).find(route => route.provider === 'jobspy');
assert.equal(routeReadiness(jobspyRoute, state({ keys: new Set(['jobspy']) })).ok, false, 'JobSpy sin proxies no se lanza');
assert.match(routeReadiness(jobspyRoute, state({ keys: new Set(['jobspy']) })).reason, /proxies sanos/);
assert.equal(routeReadiness(jobspyRoute, state({ keys: new Set(['jobspy']), proxiesHealthy: true })).ok, true);
assert.equal(groupForSource(routesForSource(entry('himalayas')), new Set()).toString(), 'direct');
assert.equal(groupForSource(routesForSource(entry('himalayas')), new Set(['brightdata'])), 'multi');
assert.equal(groupForSource(routesForSource(entry('indeed')), new Set()).toString(), 'google', 'Indeed sin claves se agrupa por Google Jobs, no como gratis por JobSpy');
// El KPI «Gratis y operativas» usa esta misma condición: JobSpy queda fuera de las vías gratuitas
// operativas; su lanzamiento se decide aparte, con los proxies sanos de `routeReadiness`.
const jobspyOnly = routesForSource(entry('indeed')).filter(route => route.provider === 'jobspy');
assert.equal(hasFreeOperationalRoute(jobspyOnly), false, 'JobSpy no se cuenta como vía gratuita operativa');
assert.equal(hasFreeOperationalRoute(routesForSource(entry('remoteok'))), true, 'un feed del motor sí cuenta como gratis y operativo');

// 3. Contrato de la petición a Bright Data y mapeo del fixture documentado.
// La API key sola es un secreto válido (es lo que emite Bright Data): antes se descartaba por «formato»
// y una clave correcta aparecía como rechazada sin haberla comprobado.
const config = parseBrightDataSecret('abc12345key:serp_zone_1:unlock_zone');
assert.deepEqual(config, { apiKey: 'abc12345key', serpZone: 'serp_zone_1', unlockerZone: 'unlock_zone' });
assert.deepEqual(parseBrightDataSecret('  abc12345key  '), { apiKey: 'abc12345key', serpZone: null, unlockerZone: null }, 'la API key sola vale');
assert.deepEqual(parseBrightDataSecret('abc12345key::unlock_zone'), { apiKey: 'abc12345key', serpZone: null, unlockerZone: 'unlock_zone' }, 'se puede dar solo la zona Unlocker');
assert.equal(parseBrightDataSecret('a:b:c:d'), null, 'cuatro partes no es el formato');
assert.equal(parseBrightDataSecret('corta'), null, 'una clave de 5 caracteres no es una API key');
const url = googleJobsUrl('closer de ventas', 'es', 'es');
assert.match(url, /ibp=htl%3Bjobs/);
assert.match(url, /brd_json=1/, 'sin brd_json=1 la respuesta puede volver como HTML');
assert.match(url, /q=closer\+de\+ventas/);
assert.equal(brightDataSource('google'), 'brightdata-google', 'Google Jobs se atribuye a brightdata-google');
assert.equal(brightDataSource('infojobs'), 'brightdata-infojobs', 'cada portal conserva su código, no un «portal» genérico');

// 3b. Zonas de la cuenta (gratis): se elige por tipo y no por el nombre, y un 401 sí es clave rechazada.
assert.deepEqual(zonesFromPayload([{ name: 'serp_api1', type: 'SERP' }, { name: 'web_unlocker1', type: 'unblocker' }]),
  [{ name: 'serp_api1', type: 'serp' }, { name: 'web_unlocker1', type: 'unblocker' }]);
assert.deepEqual(zonesFromPayload({ zones: [{ name: 'z1', type: 'serp' }, { nope: true }] }), [{ name: 'z1', type: 'serp' }]);
assert.deepEqual(pickBrightDataZones([{ name: 'w1', type: 'unblocker' }, { name: 's1', type: 'serp' }]), { serpZone: 's1', unlockerZone: 'w1' });
assert.deepEqual(pickBrightDataZones([{ name: 'proxy1', type: 'res_rotating' }]), { serpZone: null, unlockerZone: null }, 'una zona de proxy no se confunde con SERP');
const zonesFetch = async (target) => {
  assert.match(target, /\/zone\/get_active_zones$/);
  return new Response(JSON.stringify([{ name: 'serp_api1', type: 'serp' }, { name: 'web_unlocker1', type: 'unblocker' }]), { status: 200 });
};
assert.equal((await listZones('k', { fetchImpl: zonesFetch })).zones.length, 2);
const rejectedZones = await listZones('k', { fetchImpl: async () => new Response('User authentication is required', { status: 401 }) });
assert.equal(rejectedZones.status, 401);
assert.match(rejectedZones.error, /HTTP 401/);
assert.deepEqual(rejectedZones.zones, [], 'una respuesta rechazada no inventa zonas');
let zoneCalls = 0;
const resolvedBare = await resolveBrightDataConfig('abc12345key', { fetchImpl: async () => { zoneCalls++; return new Response(JSON.stringify([{ name: 'serp_api1', type: 'serp' }]), { status: 200 }); } });
assert.equal(zoneCalls, 1, 'con la clave sola se consulta la cuenta una vez, gratis');
assert.deepEqual(resolvedBare.config, { apiKey: 'abc12345key', serpZone: 'serp_api1', unlockerZone: null });
let fullCalls = 0;
const resolvedFull = await resolveBrightDataConfig('abc12345key:serp_zone_1:unlock_zone', { fetchImpl: async () => { fullCalls++; return new Response('[]', { status: 200 }); } });
assert.equal(fullCalls, 0, 'si las zonas vienen escritas no se llama a la cuenta');
assert.equal(resolvedFull.config.serpZone, 'serp_zone_1');
const resolvedDown = await resolveBrightDataConfig('abc12345key', { fetchImpl: async () => { throw new Error('timeout'); } });
assert.equal(resolvedDown.config.serpZone, null);
assert.match(resolvedDown.error, /No se pudo contactar/, 'un fallo de red no se anuncia como clave rechazada');
assert.equal((await resolveBrightDataConfig('corta')).config, null);

// 3c. El envoltorio `{status_code, headers, body}` no pierde las ofertas.
const wrapped = { status_code: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobs: { items: [{ title: 'Closer', company: 'Acme', link: 'https://acme.test/1' }] } }) };
assert.equal(unwrapPayload(wrapped).jobs.items.length, 1);
assert.equal(jobsFromPayload(wrapped).length, 1, 'las ofertas se leen dentro del envoltorio');
assert.equal(unwrapPayload({ jobs: { items: [] } }).jobs.items.length, 0, 'un payload directo se devuelve igual');

// 3d. La prueba es UNA petición con el contrato documentado, y su precio es el mismo que usa el tope.
const probeCalls = [];
const probeResponse = await serpProbeRequest({ apiKey: 'abc12345key', serpZone: 'serp_zone_1', unlockerZone: null }, async (target, init) => {
  probeCalls.push({ target, init });
  return new Response('{}', { status: 200 });
});
assert.equal(probeResponse.status, 200);
assert.equal(probeCalls.length, 1, 'la prueba no reintenta: una sola petición');
assert.equal(probeCalls[0].target, 'https://api.brightdata.com/request');
assert.equal(probeCalls[0].init.method, 'POST');
assert.equal(probeCalls[0].init.headers.Authorization, 'Bearer abc12345key');
const probeBody = JSON.parse(probeCalls[0].init.body);
assert.deepEqual(Object.keys(probeBody).sort(), ['format', 'url', 'zone']);
assert.equal(probeBody.zone, 'serp_zone_1');
assert.equal(probeBody.format, 'json');
assert.match(probeBody.url, /brd_json=1/);
assert.equal(BRIGHTDATA_USD_PER_REQUEST, PROVIDER_METERS.brightdata.usdPerRequest, 'el precio del proveedor y el del medidor del tope no pueden divergir');

const calls = [];
// Misma forma documentada que usa `brightdata.mjs`: solo title, company, location, source,
// description, link y tags. Sin fecha ni campos que la documentación no muestre.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/brightdata/serp-jobs.json', import.meta.url), 'utf8'));
const fakeFetch = async (target, init) => { calls.push({ target, init }); return new Response(JSON.stringify(fixture), { status: 200 }); };
const result = await serpJobs(config, { query: 'closer de ventas', fetchImpl: fakeFetch, now: Date.parse('2026-11-21T12:00:00Z') });
assert.equal(calls.length, 1, 'una búsqueda = una petición');
assert.equal(calls[0].target, 'https://api.brightdata.com/request');
assert.equal(calls[0].init.headers.Authorization, 'Bearer abc12345key');
const body = JSON.parse(calls[0].init.body);
assert.deepEqual(Object.keys(body).sort(), ['format', 'url', 'zone']);
assert.equal(body.zone, 'serp_zone_1');
assert.equal(body.format, 'json');
assert.match(body.url, /ibp=htl%3Bjobs/);
assert.equal(result.rawItems, 3);
assert.equal(result.candidates.length, 2, 'sin enlace no hay oferta verificable');
assert.equal(result.costUsd, 0.0015);
assert.equal(result.candidates[0].company, 'Acme');
assert.match(result.candidates[0].description, /Remoto/);
assert.equal(result.candidates[0].posted_at, null, 'sin fecha en la respuesta documentada no se inventa');
assert.equal(jobsFromPayload({ jobs_results: [{ title: 'T', company_name: 'C', location: 'L', link: 'https://x.test/1', via: 'V' }] }).length, 1, 'acepta la forma de SerpApi si la zona cambia');

await assert.rejects(() => serpJobs({ apiKey: 'abc12345key', serpZone: null, unlockerZone: null }, { query: 'x' }), /zona SERP/, 'sin zona no se lanza una petición que se cobraría');
let authCalls = 0;
await assert.rejects(() => serpJobs(config, { query: 'x', fetchImpl: async () => { authCalls++; return new Response('nope', { status: 401 }); } }), /HTTP 401/);
assert.equal(authCalls, 1, 'un 401 no se reintenta');
let retryCalls = 0;
await assert.rejects(() => serpJobs(config, { query: 'x', fetchImpl: async () => { retryCalls++; return new Response('busy', { status: 429 }); } }), /HTTP 429/);
assert.equal(retryCalls, 2, 'un 429 se reintenta una vez y se declara');
let flaky = 0;
const recovered = await serpJobs(config, { query: 'x', fetchImpl: async () => {
  flaky++;
  return flaky === 1 ? new Response('busy', { status: 429 }) : new Response(JSON.stringify(fixture), { status: 200 });
} });
assert.equal(recovered.requests, 2, 'un reintento cuenta dos peticiones');
assert.equal(recovered.costUsd, 0.003, 'el coste anota los dos intentos, no solo el que respondió');
let networkError;
await assert.rejects(() => serpJobs(config, { query: 'x', fetchImpl: async () => { throw new Error('timeout'); } }), err => { networkError = err; return /No se pudo contactar/.test(err.message); });
assert.equal(networkError.status, null, 'un fallo de red no inventa un HTTP');
assert.equal(networkError.attempts, 2, 'un fallo de red declara los dos intentos para poder anotarlos');
const empty = await serpJobs(config, { query: 'x', fetchImpl: async () => new Response(JSON.stringify({ jobs: { items: [] } }), { status: 200 }) });
assert.deepEqual(empty.candidates, [], '0 resultados es una lista vacía, no un error');

// 4. Contabilidad: la nota se puede volver a leer y el tope frena antes de gastar.
const note = spendNote({ route: '3/5', provider: 'brightdata', requests: 2, costUsd: 0.003, detail: 'infojobs' });
assert.equal(costFromNote(note), 0.003);
assert.equal(spentFromNotes([{ note }], 'brightdata').usd, 0.003);
assert.equal(canSpend('brightdata', 4.9999, { BRIGHTDATA_MONTHLY_USD: '5' }).ok, false);
assert.equal(canSpend('brightdata', 4.99, { BRIGHTDATA_MONTHLY_USD: '5' }).ok, true);

// 5. Cascada: para en la primera con ofertas y declara los saltos.
const infojobsRoutes = routesForSource(entry('infojobs'));
const steps = planCascade(infojobsRoutes, state({ keys: new Set(['infojobs', 'brightdata', 'serpapi']), budget: { brightdata: 5, serpapi: 5 } }));
assert.equal(steps.filter(step => step.ready).length, 3, 'oficial, Bright Data y SerpApi listas');
assert.deepEqual(steps.map(step => step.route.provider), ['official', 'brightdata', 'serpapi', 'apify'], 'InfoJobs con Bright Data: orden por coste');
const seen = [];
const cascade = await runCascade(steps, async route => {
  seen.push(route.provider);
  if (route.provider === 'official') return { accepted: 0 };
  if (route.provider === 'brightdata') return { accepted: 2 };
  return { accepted: 5 };
});
assert.deepEqual(seen, ['official', 'brightdata'], 'no se llama a SerpApi si Bright Data ya trajo ofertas');
assert.equal(cascade.winner?.provider, 'brightdata');
const serpapiStep = cascade.attempts.find(attempt => attempt.route.provider === 'serpapi');
assert.equal(serpapiStep?.status, 'omitida');
assert.match(serpapiStep?.note ?? '', /ya trajo ofertas/, 'una vía lista después del ganador se declara omitida, no se lanza');
assert.match(cascade.attempts.find(attempt => attempt.route.provider === 'apify')?.note ?? '', /Sin clave de apify/, 'las vías sin clave también se declaran');
const failing = await runCascade(planCascade(infojobsRoutes, state({ keys: new Set(['brightdata']), budget: { brightdata: 5 } })), async route => {
  if (route.provider === 'brightdata') throw new Error('HTTP 503 tras reintento');
  return { accepted: 1 };
});
assert.equal(failing.attempts.find(attempt => attempt.route.provider === 'brightdata')?.status, 'error');
assert.equal(failing.attempts.find(attempt => attempt.route.provider === 'serpapi')?.note, 'Sin clave de serpapi: no se intenta.');

// 5b. Sin clave de Bright Data, Google Jobs cae a SerpApi sin error y el salto queda declarado.
const withoutBrightData = planCascade(infojobsRoutes, state({ keys: new Set(['infojobs', 'serpapi']), budget: { serpapi: 5 } }));
const withoutBrightDataSeen = [];
const withoutBrightDataRun = await runCascade(withoutBrightData, async route => {
  withoutBrightDataSeen.push(route.provider);
  return route.provider === 'official' ? { accepted: 0 } : { accepted: 1 };
});
assert.deepEqual(withoutBrightDataSeen, ['official', 'serpapi'], 'sin Bright Data se prueba SerpApi');
assert.equal(withoutBrightDataRun.winner?.provider, 'serpapi');
const skippedBrightData = withoutBrightDataRun.attempts.find(attempt => attempt.route.provider === 'brightdata');
assert.equal(skippedBrightData?.status, 'omitida');
assert.match(skippedBrightData?.note ?? '', /Sin clave de brightdata/);
assert.ok(!withoutBrightDataRun.attempts.some(attempt => attempt.status === 'error'), 'la caída no es un error');

const indeedWithoutBrightData = planCascade(routesForSource(entry('indeed')), state({ keys: new Set(['serpapi']), budget: { serpapi: 5 } }));
const indeedWithoutBrightDataSeen = [];
const indeedWithoutBrightDataRun = await runCascade(indeedWithoutBrightData, async route => {
  indeedWithoutBrightDataSeen.push(route.provider);
  return { accepted: 1 };
});
assert.deepEqual(indeedWithoutBrightDataSeen, ['serpapi'], 'Indeed sin Bright Data cae a SerpApi');
assert.equal(indeedWithoutBrightDataRun.winner?.provider, 'serpapi');
assert.equal(indeedWithoutBrightDataRun.attempts.find(attempt => attempt.route.provider === 'brightdata')?.status, 'omitida');

// 5c. JobSpy sin proxies sanos: se salta al final y se declara; no lanza ni rompe la cascada.
const jobspySteps = planCascade(routesForSource(entry('indeed')), state({ keys: new Set(['brightdata', 'serpapi', 'apify', 'jobspy']), budget: { brightdata: 5, serpapi: 5 }, proxiesHealthy: false }));
assert.equal(jobspySteps.at(-1)?.route.provider, 'jobspy', 'JobSpy sigue al final');
const jobspyRun = await runCascade(jobspySteps, async () => ({ accepted: 0 }));
const jobspyAttempt = jobspyRun.attempts.find(attempt => attempt.route.provider === 'jobspy');
assert.equal(jobspyAttempt?.status, 'omitida');
assert.match(jobspyAttempt?.note ?? '', /proxies sanos/);
assert.ok(!jobspyRun.attempts.some(attempt => attempt.status === 'error'), 'sin proxies no se quema el runner');

// 5d. El orden se ve y se puede cambiar; sin override vuelve al de coste y JobSpy no se adelanta.
const infojobsForOrder = routesForSource(entry('infojobs'));
const defaultInfojobsOrder = orderRoutes(infojobsForOrder).map(route => route.provider);
assert.deepEqual(defaultInfojobsOrder, ['official', 'brightdata', 'serpapi', 'apify']);
const serpapiId = infojobsForOrder.find(route => route.provider === 'serpapi').id;
const officialId = infojobsForOrder.find(route => route.provider === 'official').id;
assert.deepEqual(orderRoutes(infojobsForOrder, [serpapiId, officialId]).map(route => route.provider), ['serpapi', 'official', 'brightdata', 'apify']);
assert.deepEqual(orderRoutes(infojobsForOrder, []).map(route => route.provider), defaultInfojobsOrder, 'sin override manda el coste');
const indeedForOrder = routesForSource(entry('indeed'));
const jobspyId = indeedForOrder.find(route => route.provider === 'jobspy').id;
const movedIndeed = orderRoutes(indeedForOrder, [jobspyId, ...indeedForOrder.filter(route => route.provider !== 'jobspy').map(route => route.id)]);
assert.equal(movedIndeed.at(-1)?.provider, 'jobspy', 'JobSpy no se puede adelantar ni con override');
assert.deepEqual(planCascade(indeedForOrder, state(), [jobspyId]).map(step => step.route.provider).at(-1), 'jobspy');

// 5e. Unlocker: la misma zona de Bright Data, el extractor común y la misma contabilidad.
const companyRoutes = routesForSource(entry('company'));
const unlocker = companyRoutes.find(route => route.provider === 'unlocker');
assert.ok(unlocker, 'la fuente «company» tiene vía Unlocker');
assert.deepEqual(unlocker.requiresAnyKey, ['brightdata', 'zenrows', 'scrapingbee'], 'Unlocker vale con cualquiera de las tres claves');
assert.equal(routeReadiness(unlocker, state()).ok, false);
assert.match(routeReadiness(unlocker, state()).reason, /Sin clave de brightdata ni zenrows ni scrapingbee/);
assert.equal(routeReadiness(unlocker, state({ keys: new Set(['zenrows']), budget: { zenrows: 5 } })).ok, true, 'ZenRows también desbloquea el extractor');
assert.equal(routeReadiness(unlocker, state({ keys: new Set(['brightdata']), budget: { brightdata: 5 } })).ok, true);
const serpOnly = state({ keys: new Set(['brightdata']), budget: { brightdata: 5 }, unlockerReady: false });
assert.equal(routeReadiness(unlocker, serpOnly).ok, false, 'sin zona Unlocker no está lista');
assert.match(routeReadiness(unlocker, serpOnly).reason, /zona Unlocker/);
assert.equal(unlockerProviderFor(serpOnly), null, 'una clave SERP sin zona no se lanza como Unlocker');
assert.equal(routeReadiness(unlocker, state({ keys: new Set(['brightdata', 'zenrows']), budget: { brightdata: 5, zenrows: 5 }, unlockerReady: false })).ok, true, 'otra clave de HTML puede sustituir la zona ausente');

// 5f. Dos proveedores con saldos distintos: se elige el que de verdad se lanza y se mira SU tope.
const zenrowsSinSaldo = state({ keys: new Set(['brightdata', 'zenrows']), budget: { brightdata: 5, zenrows: 0 } });
assert.equal(unlockerProviderFor(zenrowsSinSaldo), 'brightdata', 'si ZenRows está agotado, se lanza Bright Data');
assert.equal(routeReadiness(unlocker, zenrowsSinSaldo).ok, true, 'la disponibilidad sigue al proveedor elegido');
const brightdataSinSaldo = state({ keys: new Set(['brightdata', 'zenrows']), budget: { brightdata: 0, zenrows: 5 }, unlockerReady: false });
assert.equal(unlockerProviderFor(brightdataSinSaldo), 'zenrows', 'si Bright Data no tiene zona ni saldo, se lanza ZenRows');
assert.equal(routeReadiness(unlocker, brightdataSinSaldo).ok, true);
const ambosSinSaldo = state({ keys: new Set(['brightdata', 'zenrows']), budget: { brightdata: 0, zenrows: 0 }, unlockerReady: false });
assert.equal(unlockerProviderFor(ambosSinSaldo), null);
assert.match(routeReadiness(unlocker, ambosSinSaldo).reason, /Tope mensual agotado para brightdata, zenrows/);
const casiSinSaldo = state({ keys: new Set(['brightdata']), budget: { brightdata: 0.002 } });
assert.equal(unlockerProviderFor(casiSinSaldo), null, '0,002 USD no cubre los dos intentos que reserva el POST');
assert.match(routeReadiness(unlocker, casiSinSaldo).reason, /Tope mensual agotado/);
assert.equal(canSpend('zenrows', 0, { ZENROWS_MONTHLY_USD: '5' }).ok, true, 'el tope de ZenRows es el suyo');
assert.equal(canSpend('zenrows', 5, { ZENROWS_MONTHLY_USD: '5' }).ok, false);
assert.equal(canSpend('brightdata', 5, {}).ok, false, 'el tope de Bright Data no se mezcla con el de ZenRows');
const zenrowsNote = spendNote({ route: '7/7', provider: 'zenrows', requests: 1, costUsd: 0.002, detail: 'company · unlocker' });
assert.equal(spentFromNotes([{ note: zenrowsNote }], 'zenrows').usd, 0.002, 'la nota de ZenRows suma a ZenRows');
assert.equal(spentFromNotes([{ note: zenrowsNote }], 'brightdata').usd, null, 'la nota de ZenRows no consume el saldo de Bright Data');
assert.equal(brightDataSource('company'), 'brightdata-company', 'el HTML se atribuye a brightdata-<portal>');
const unlockerNote = spendNote({ route: '7/7', provider: 'brightdata', requests: 1, costUsd: 0.0015, detail: 'company · unlocker' });
assert.equal(spentFromNotes([{ note: unlockerNote }], 'brightdata').usd, 0.0015);
assert.equal(canSpend('brightdata', 4.9985).ok, true);
assert.equal(canSpend('brightdata', 4.9999).ok, false);
assert.equal(canSpend('brightdata', 4.998, { BRIGHTDATA_MONTHLY_USD: '5' }).ok, true, 'una petición cabe');
assert.equal(canSpend('brightdata', 4.998, { BRIGHTDATA_MONTHLY_USD: '5' }, 2).ok, false, 'dos intentos no caben: se reserva el peor caso');

// 6. Extractor común: JSON-LD y RSS, sin inventar campos.
const jsonld = `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Closer","datePosted":"2026-11-20","description":"<p>Ventas &amp; más</p>","hiringOrganization":{"name":"Acme"},"jobLocation":{"address":{"addressLocality":"Madrid","addressCountry":"ES"}},"baseSalary":{"currency":"EUR","value":{"minValue":30000,"maxValue":40000,"unitText":"YEAR"}},"url":"https://acme.test/jobs/1"}</script></html>`;
const jsonJobs = extractJobPostings(jsonld, 'https://acme.test/jobs');
assert.equal(jsonJobs.length, 1);
assert.equal(jsonJobs[0].company, 'Acme');
assert.equal(jsonJobs[0].location, 'Madrid, ES');
assert.match(jsonJobs[0].salary, /30000–40000 EUR YEAR/);
assert.equal(jsonJobs[0].description, 'Ventas & más');
const rss = `<?xml version="1.0"?><rss><channel><item><title>Setter &amp; closer</title><link>https://acme.test/jobs/2</link><description><![CDATA[<p>Remoto</p>]]></description><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
const rssJobs = extractJobPostings(rss, 'https://acme.test/jobs');
assert.equal(rssJobs.length, 1);
assert.equal(rssJobs[0].title, 'Setter & closer');
assert.equal(rssJobs[0].description, 'Remoto');
assert.deepEqual(extractJobPostings('<html><body>sin datos</body></html>', 'https://acme.test'), []);
// Algunos gestores cierran el comentario con `--!>`: el extractor debe limpiarlo igual que `-->`.
const commented = `<script type="application/ld+json"><!-- {"@context":"https://schema.org","@type":"JobPosting","title":"Comentado","url":"https://acme.test/jobs/3"} --!></script>`;
assert.equal(extractJobPostings(commented, 'https://acme.test/jobs').length, 1, 'cierre de comentario --!>');

// 7. Guías: pasos, fecha, tres fallos y enlaces https. Ninguna fuente se queda sin receta.
for (const item of catalog) {
  const setup = setupFor(item);
  assert.ok(setup.requirement.length > 10, `${item.code}: requisito vacío`);
  assert.ok(setup.steps.length >= 2, `${item.code}: menos de dos pasos`);
  assert.ok(setup.steps.every(step => step.trim().length > 5), `${item.code}: paso vacío`);
  assert.equal(setup.failures?.length, 3, `${item.code}: faltan los tres fallos típicos`);
  assert.ok(setup.checkedAt, `${item.code}: sin fecha de comprobación`);
  if (setup.docs) assert.match(setup.docs.href, /^https:\/\//, `${item.code}: documentación sin HTTPS`);
  if (setup.alternatives) for (const alt of setup.alternatives) if (alt.href) assert.match(alt.href, /^https:\/\//, `${item.code}: alternativa sin HTTPS`);
  assert.ok(!setup.video, `${item.code}: no hay vídeo verificado, no debe inventarse`);
}

// 8. Empresas: la lista no duplica códigos y todo ATS existe en el catálogo.
const codes = COMPANY_WATCHLIST.map(company => company.code);
assert.equal(new Set(codes).size, codes.length);
for (const company of COMPANY_WATCHLIST) {
  if (company.kind === 'ats') assert.ok(entry(company.code), `${company.code} no está en el catálogo`);
  if (company.url) assert.match(company.url, /^https:\/\//);
}

console.log('source-routes: rutas, contrato Bright Data, extractor, cascada y guías OK');
