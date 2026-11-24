// Entradas de Apify tras la prueba real del 2026-11-24: listas cerradas de países (HTTP 400), tope de longitud (Trabajos.com), búsqueda
// por término y país de cada día, plantillas leídas de los esquemas públicos, mapeo de Indeed (positionName) y diagnóstico de
// «llegaron elementos pero ninguno guardable». Sin red.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/apify-inputs.mjs
import assert from 'node:assert/strict';
import { adaptInput, fillTemplate, fitText, enumValue, isoOf, mapItem, noKeptText, varsFor, QUERIES } from '../../apps/web/lib/apify.ts';
import { PORTALS, portalById, queryForDay, countryForDay, dayIndex } from '../../apps/web/lib/apifyCatalog.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const vars = (over = {}) => varsFor({ max_items: 10 }, over);

step('lista cerrada de países: «Spain» no se manda a un countryCode que no lo admite; «MX» sí, en la forma de su lista', () => {
  const schema = { required: [], properties: { keyword: { type: 'string' }, countryCode: { type: 'string', enum: ['ar', 'mx', 'co', 'cl', 'pe'] }, maxJobs: { type: 'integer' } } };
  const spain = adaptInput(schema, vars());
  assert.equal(spain.input.countryCode, undefined, 'sin valor válido se omite y manda el defecto del actor');
  const mx = adaptInput(schema, vars({ country: 'MX' }));
  assert.equal(mx.input.countryCode, 'mx');
  const named = adaptInput({ required: [], properties: { country: { type: 'string', enum: ['Spain', 'Mexico', 'Chile'] } } }, vars({ country: 'MX' }));
  assert.equal(named.input.country, 'Mexico', 'lista con nombres: el nombre');
  assert.equal(enumValue(['ES', 'MX'], 'Spain'), 'ES'); assert.equal(isoOf('Spain'), 'ES'); assert.equal(isoOf('mx'), 'MX');
});

step('tope de longitud del esquema: se conservan términos COMPLETOS, nunca una comilla abierta (Trabajos.com, máx. 100)', () => {
  const schema = { required: [], properties: { keywords: { type: 'string', maxLength: 100 } } };
  const out = adaptInput(schema, vars()).input.keywords;
  assert.ok(out.length <= 100, `${out.length} caracteres`);
  assert.equal((out.match(/"/g) ?? []).length % 2, 0, 'comillas balanceadas');
  assert.ok(out.startsWith('"closer de ventas"'));
  assert.equal(fitText('closer de ventas', 100), 'closer de ventas');
  assert.ok(fitText('palabra '.repeat(30), 50).length <= 50);
});

step('Trabajos.com y cualquier portal sin lista propia buscan UN término corto por día (nunca los siete con OR)', () => {
  const trabajos = portalById('trabajos');
  const term = queryForDay(trabajos, Date.parse('2026-11-24T10:00:00Z'));
  assert.ok(term && term.length < 40 && !/ OR /.test(term), term);
  const days = new Set([0, 1, 2, 3].map(d => queryForDay(trabajos, Date.parse('2026-11-24T10:00:00Z') + d * 86_400_000)));
  assert.ok(days.size >= 3, 'rota de un día a otro');
  for (const portal of PORTALS) { if (portal.id === 'multi') continue; const q = queryForDay(portal); assert.ok(q && q.length <= 100, `${portal.id}: ${q}`); }
  assert.ok(QUERIES.length >= 5);
});

step('plantillas leídas de los esquemas públicos: Computrabajo, Bumeran, Jooble (agentx) y Eures', () => {
  const find = (id, actor) => portalById(id).recipes.find(r => r.actor.toLowerCase() === actor);
  const day = Date.parse('2026-11-24T10:00:00Z');
  const comp = find('computrabajo', 'shahidirfan/computrabajo-jobs-scraper');
  const country = countryForDay(portalById('computrabajo'), day);
  assert.ok(['MX', 'CO', 'AR', 'CL', 'PE'].includes(country));
  const input = fillTemplate(comp.inputTemplate, vars({ query: 'closer de ventas', country }));
  assert.deepEqual(input, { keyword: 'closer de ventas', countryCode: country.toLowerCase(), maxJobs: 10 });
  const bum = fillTemplate(find('laborum', 'blackfalcondata/bumeran-scraper').inputTemplate, vars({ query: 'setter', country: 'PE' }));
  assert.deepEqual(bum, { query: 'setter', country: 'PE', postedWithin: '7days', maxResults: 10 });
  assert.deepEqual(fillTemplate(find('laborum', 'memo23/bumeran-job-scraper').inputTemplate, vars({ query: 'setter' })), { searchQueries: ['setter'] });
  const jooble = fillTemplate(find('jooble', 'agentx/jooble-jobs-scraper').inputTemplate, vars({ query: 'closer', country: 'MX' }));
  assert.deepEqual(jooble, { keyword: 'closer', country: 'Mexico', max_results: 10 }, 'agentx pide el nombre del país, no «es»');
  assert.deepEqual(fillTemplate(find('eures', 'dadhalfdev/eures-jobs-scraper').inputTemplate, vars({ query: 'closer' })), { keywords: 'closer', country: 'es' });
  assert.deepEqual(portalById('jooble').countries, ['ES', 'MX', 'CO', 'AR', 'CL', 'PE']);
  assert.equal(countryForDay(portalById('trabajos')), undefined, 'un portal de un solo país no rota por países');
  assert.notEqual(countryForDay(portalById('jooble'), day), countryForDay(portalById('jooble'), day + 86_400_000));
  assert.ok(dayIndex(day) > 0);
});

step('Indeed (misceres): positionName, company, location y url se reconocen; sin enlace no hay candidato', () => {
  const item = { positionName: 'Closer de ventas', company: 'Acme', location: 'Madrid', url: 'https://es.indeed.com/viewjob?jk=1', id: 'abc', postedAt: 'Today', salary: null, jobType: ['Fulltime'], description: 'Buscamos closer' };
  const c = mapItem(item);
  assert.equal(c.title, 'Closer de ventas'); assert.equal(c.company, 'Acme'); assert.equal(c.url, 'https://es.indeed.com/viewjob?jk=1'); assert.equal(c.external_id, 'abc');
  assert.equal(mapItem({ positionName: 'Sin enlace' }), null);
});

step('diagnóstico: llegaron elementos pero ninguno guardable se dice con los campos del primero; con ofertas guardadas o sin elementos no hay aviso', () => {
  assert.match(noKeptText(10, 0, 'foo, bar'), /Llegaron 10 elemento\(s\) pero ninguno.*Campos del primero: foo, bar/);
  assert.equal(noKeptText(10, 3, 'foo'), null); assert.equal(noKeptText(0, 0, ''), null);
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
