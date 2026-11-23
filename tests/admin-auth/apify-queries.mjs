// Búsquedas de Apify por término: LinkedIn y Workana rotan un sinónimo canónico al día (una sola
// ejecución diaria, mismo coste) y cada repuesto recibe la plantilla de SU esquema, no la de otro.
// Sin red ni Apify: lo que se prueba es el input que la app construiría.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/apify-queries.mjs
import assert from 'node:assert/strict';
import { PORTALS, portalById, queryForDay, dayIndex } from '../../apps/web/lib/apifyCatalog.ts';
import { adaptInput, fillTemplate } from '../../apps/web/lib/apify.ts';
import { ROLE_KEYWORDS, roleFromTitle } from '../../apps/web/lib/vocabulary.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

const linkedin = portalById('linkedin');
const workana = portalById('workana');
const canonical = new Set(Object.values(ROLE_KEYWORDS).flat());
const DAY = 86_400_000;
const at = iso => Date.parse(iso);

step('LinkedIn y Workana rotan por términos canónicos del motor', () => {
  for (const portal of [linkedin, workana]) {
    assert.ok(portal.queries?.length >= 6, `${portal.id}: menos de 6 términos`);
    assert.equal(new Set(portal.queries).size, portal.queries.length, `${portal.id}: término repetido`);
    assert.equal(portal.queries[0], portal.query, `${portal.id}: el primero debe ser el de siempre`);
    for (const term of portal.queries) {
      assert.ok(canonical.has(term), `${portal.id}: «${term}» no está en el vocabulario canónico`);
    }
  }
  // Los dos portales no buscan lo mismo: LinkedIn es empleo (inglés incluido), Workana proyectos.
  assert.ok(linkedin.queries.includes('high ticket closer'), 'LinkedIn cubre la variante inglesa');
  assert.ok(workana.queries.includes('cierre de ventas'), 'Workana cubre el cierre como servicio');
  assert.ok(!workana.queries.includes('ventas'), '«ventas» a secas era el término que traía ruido');
});

step('la rotación es determinista por día UTC y vuelve a empezar', () => {
  const day = at('2026-11-22T00:00:00Z');
  assert.equal(dayIndex(day), day / DAY);
  const pick = offset => linkedin.queries[(dayIndex(day) + offset) % linkedin.queries.length];
  assert.equal(queryForDay(linkedin, day), pick(0), 'cada día tiene un término fijo, no aleatorio');
  assert.equal(queryForDay(linkedin, day + 3600_000), pick(0), 'la hora no cambia el término');
  assert.equal(queryForDay(linkedin, day + DAY), pick(1), 'al día siguiente, el siguiente');
  const full = linkedin.queries.length * DAY;
  assert.equal(queryForDay(linkedin, day + full), pick(0), 'la lista se recorre entera y vuelve');
  // Un portal sin lista sigue usando su única búsqueda; uno sin ninguna no inventa término.
  assert.equal(queryForDay({ query: 'closer' }, day), 'closer');
  assert.equal(queryForDay({}, day), undefined);
});

step('LinkedIn ya no ofrece el buscador que devolvía 404 y conserva cuatro', () => {
  const actors = linkedin.recipes.map(r => r.actor);
  assert.equal(actors.length, 4);
  assert.ok(!actors.includes('crawlworks/linkedin-job-scraper'), 'crawlworks daba 404 en la API pública (2026-11-22)');
  assert.ok(actors.includes('cheap_scraper/linkedin-job-scraper'), 'entra el candidato auditado');
});

step('cada buscador de LinkedIn recibe su campo real de búsqueda', () => {
  const vars = { query: 'high ticket closer', location: 'España', country: 'Spain', max_items: 10, hours_old: 240, sites: [] };
  // Esquemas leídos de la API pública de Apify el 2026-11-22.
  const schemas = {
    'curious_coder/linkedin-jobs-scraper': { properties: { keywords: { type: 'string' }, location: { type: 'string' }, urls: { type: 'array' } }, required: [] },
    'cheap_scraper/linkedin-job-scraper': { properties: { keyword: { type: 'array' }, locations: { type: 'array' }, maxItems: { type: 'integer' } }, required: [] },
    'gopalakrishnan/linkedin-jobs': { properties: { keywords: { type: 'string' }, location: { type: 'string' }, maxResults: { type: 'integer' } }, required: ['keywords'] },
    'harvestapi/linkedin-job-search': { properties: { jobTitles: { type: 'array' }, locations: { type: 'array' }, maxItems: { type: 'integer' } }, required: [] },
  };
  for (const recipe of linkedin.recipes) {
    const schema = schemas[recipe.actor];
    assert.ok(schema, `sin esquema leído para ${recipe.actor}`);
    const { input, missing } = adaptInput(schema, vars);
    assert.deepEqual(missing, [], `${recipe.actor}: la app no puede rellenar ${missing.join(', ')}`);
    const sent = JSON.stringify(input);
    assert.ok(sent.includes('high ticket closer'), `${recipe.actor}: no recibe la búsqueda del día`);
  }
});

step('Workana usa la plantilla de cada buscador, no una común', () => {
  const vars = { query: 'setter de ventas', location: 'España', country: 'Spain', max_items: 100, hours_old: 240, sites: [] };
  const inputs = Object.fromEntries(workana.recipes.map(r => [r.actor, fillTemplate(r.inputTemplate ?? workana.inputTemplate, vars)]));
  const a = inputs['automation-lab/workana-freelance-projects-scraper'];
  assert.deepEqual(a, { query: 'setter de ventas', category: 'sales-marketing', locale: 'es', maxItems: 100, maxPages: 5 });
  assert.equal('country' in a, false, 'Workana espera un ISO de dos letras: no se le manda «Spain»');
  const b = inputs['getdataforme/workana-job-scraper'];
  assert.deepEqual(b, { searchQuery: 'setter de ventas', maxRequestsPerCrawl: 5 }, 'B exige `searchQuery`');
  const c = inputs['gio21/workana-scraper'];
  assert.deepEqual(c, { keyword: 'setter de ventas', language: 'es', maxItems: 100 }, 'C busca por `keyword`');
});

step('todos los portales con lista siguen siendo una sola búsqueda al día', () => {
  for (const portal of PORTALS) {
    if (!portal.queries) continue;
    const day = dayIndex(at('2026-11-22T00:00:00Z'));
    assert.equal(queryForDay(portal, at('2026-11-22T10:00:00Z')), portal.queries[day % portal.queries.length], `${portal.id}: no rota dentro del día`);
  }
});

step('«cerrajero» no entra por la puerta de atrás: el clasificador determinista no lo da por ventas', () => {
  assert.equal(roleFromTitle('Cerrajero autónomo'), null);
  assert.equal(roleFromTitle('Closer de ventas high ticket'), 'closer');
});

step('LinkedIn B/C e InfoJobs: la plantilla de cada actor se rellena con su campo, país España y sin credenciales', () => {
  const vars = { max_items: 10, query: 'appointment setter' };
  const [, b, c] = linkedin.recipes;
  const inB = fillTemplate(b.inputTemplate, vars);
  assert.deepEqual(inB.keyword, ['appointment setter'], 'B espera `keyword` como lista');
  assert.deepEqual(inB.locations, ['España']);
  assert.equal(inB.maxItems, 10);
  assert.equal(inB.publishedAt, 'r604800');
  const inC = fillTemplate(c.inputTemplate, vars);
  assert.equal(inC.keywords, 'appointment setter', 'C exige `keywords` (cadena)');
  assert.equal(inC.location, 'España', 'C por defecto busca en United States: se fija');
  assert.equal(inC.maxResults, 10);
  for (const recipe of linkedin.recipes) assert.ok(!/cookie|session|password|token/i.test(JSON.stringify(recipe.inputTemplate ?? {})), 'sin credenciales (ADR-011)');
  const infojobs = portalById('infojobs');
  assert.ok(infojobs.queries.length >= 5 && infojobs.queries[0] === infojobs.query, 'InfoJobs rota términos');
  for (const term of infojobs.queries) assert.ok(typeof term === 'string' && term.length > 3);
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
