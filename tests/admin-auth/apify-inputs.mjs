// Entradas de Apify tras la prueba real del 2026-11-24: listas cerradas de países (HTTP 400), tope de longitud (Trabajos.com), búsqueda
// por término y país de cada día, plantillas leídas de los esquemas públicos, mapeo de Indeed (positionName) y diagnóstico de
// «llegaron elementos pero ninguno guardable». Sin red.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/apify-inputs.mjs
import assert from 'node:assert/strict';
import { adaptInput, fillTemplate, fitText, enumValue, isoOf, mapItem, noKeptText, varsFor, QUERIES, targetFields, NO_TARGETS_MESSAGE } from '../../apps/web/lib/apify.ts';
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

step('actores base (2026-11-24): Computrabajo abotapi/reventadata, red Bumeran, OCC y LinkedIn Fantastic.jobs van delante con su entrada', () => {
  const find = (id, actor) => portalById(id).recipes.find(r => r.actor === actor);
  assert.equal(portalById('computrabajo').recipes[0].actor, 'abotapi/computrabajo-jobs-scraper');
  const day = Date.parse('2026-11-24T10:00:00Z');
  const abot = fillTemplate(find('computrabajo', 'abotapi/computrabajo-jobs-scraper').inputTemplate, vars({ query: 'closer', country: 'CO' }));
  assert.deepEqual(abot, { mode: 'search', searchQueries: ['closer'], countries: ['co'], fetchReviews: false, maxReviews: 0, maxItems: 10 }, 'sin opiniones de empresas');
  assert.deepEqual(fillTemplate(find('computrabajo', 'reventadata/computrabajo-scraper').inputTemplate, vars({ query: 'setter', country: 'MX' })), { country: 'mx', searchQueries: ['setter'], maxItems: 10 });
  assert.deepEqual(fillTemplate(find('laborum', 'bibian/latam-jobs-bumeran-scraper').inputTemplate, vars({ query: 'closer', country: 'AR' })), { countries: ['argentina'], keywords: 'closer' });
  assert.ok(portalById('occ-mundial').recipes.some(r => r.actor === 'unfenced-group/occ-com-mx-scraper'));
  const li = fillTemplate(find('linkedin', 'fantastic-jobs/advanced-linkedin-job-search-api').inputTemplate, vars({ query: 'closer de ventas', country: 'US' }));
  assert.deepEqual(li.locationSearch, ['United States']); assert.deepEqual(li.aiLanguageFilter, ['Spanish']); assert.equal(li.limit, 10); assert.deepEqual(li.titleSearch, ['closer de ventas']);
  assert.equal(portalById('linkedin').recipes[0].actor, 'fantastic-jobs/advanced-linkedin-job-search-api');
  assert.ok(countryForDay(portalById('linkedin'), day));
  for (const id of ['computrabajo', 'laborum', 'occ-mundial', 'linkedin']) assert.equal(new Set(portalById(id).recipes.map(r => r.actor)).size, portalById(id).recipes.length, `${id}: sin actores repetidos`);
});

step('empresas y Elempleo: el actor con búsqueda por título y descripción completa va primero, con su entrada leída del esquema', () => {
  const find = (id, actor) => portalById(id).recipes.find(r => r.actor === actor);
  assert.equal(portalById('company').recipes[0].actor, 'fantastic-jobs/greenhouse-jobs-api');
  const gh = fillTemplate(find('company', 'fantastic-jobs/greenhouse-jobs-api').inputTemplate, vars({ query: 'closer de ventas', country: 'ES' }));
  assert.deepEqual(gh.titleSearch, ['closer de ventas']); assert.equal(gh.descriptionType, 'text'); assert.ok(gh.limit >= 200, 'el esquema exige límite mínimo 200');
  assert.equal(portalById('elempleo').recipes[0].actor, 'scrapers_lat/elempleo-scraper');
  const el = fillTemplate(find('elempleo', 'scrapers_lat/elempleo-scraper').inputTemplate, vars({ query: 'asesor comercial' }));
  assert.deepEqual(el.keywords, ['asesor comercial']); assert.equal(el.withDetails, true, 'sin detalle no hay descripción y se descarta');
  for (const id of ['company', 'elempleo']) assert.equal(new Set(portalById(id).recipes.map(r => r.actor)).size, portalById(id).recipes.length, `${id}: sin actores repetidos`);
});

step('mapItem guarda las claves del item en raw para diagnosticar la extracción desde la base', () => {
  const c = mapItem({ title: 'Closer', url: 'https://x.test/1', foo: 1, bar: 2 });
  assert.equal(c.raw.item_keys, 'title,url,foo,bar', 'texto, no lista: classify solo deja pasar valores simples');
});

step('direcciones a vigilar: {{start_urls}} y {{target_names}} en plantillas, y el esquema del actor decide la forma (objetos, textos o nombres)', () => {
  const withTargets = { ...vars(), start_urls: ['https://www.facebook.com/groups/closers', 'https://www.facebook.com/groups/setters'], target_names: ['closers', 'setters'] };
  assert.deepEqual(fillTemplate({ startUrls: '{{start_urls}}', max: '{{max_items}}' }, withTargets), { startUrls: [{ url: 'https://www.facebook.com/groups/closers' }, { url: 'https://www.facebook.com/groups/setters' }], max: 10 });
  assert.deepEqual(fillTemplate({ urls: '{{start_urls_text}}', profiles: '{{target_names}}' }, withTargets), { urls: ['https://www.facebook.com/groups/closers', 'https://www.facebook.com/groups/setters'], profiles: ['closers', 'setters'] });
  assert.deepEqual(fillTemplate({ startUrls: '{{start_urls}}' }, vars()), { startUrls: [] }, 'sin direcciones: lista vacía, nunca una cadena sin rellenar');
  const objects = adaptInput({ required: ['startUrls'], properties: { startUrls: { type: 'array', items: { type: 'object' } } } }, withTargets);
  assert.deepEqual(objects.input.startUrls, [{ url: 'https://www.facebook.com/groups/closers' }, { url: 'https://www.facebook.com/groups/setters' }]); assert.deepEqual(objects.missing, []);
  const strings = adaptInput({ required: [], properties: { urls: { type: 'array', items: { type: 'string' } } } }, withTargets);
  assert.deepEqual(strings.input.urls, ['https://www.facebook.com/groups/closers', 'https://www.facebook.com/groups/setters']);
  const names = adaptInput({ required: ['profiles'], properties: { profiles: { type: 'array', items: { type: 'string' } } } }, withTargets);
  assert.deepEqual(names.input.profiles, ['closers', 'setters']);
  const none = adaptInput({ required: ['startUrls'], properties: { startUrls: { type: 'array', items: { type: 'object' } } } }, vars());
  assert.deepEqual(none.missing, ['startUrls']); assert.deepEqual(targetFields(none.missing), ['startUrls']);
  assert.deepEqual(targetFields(['startUrls', 'cookies']), ['startUrls'], 'solo los campos de direcciones; las cookies siguen siendo otra cosa');
  assert.match(NO_TARGETS_MESSAGE, /Direcciones a vigilar/);
});

// Publicaciones de redes (grupos de Facebook, canales de Telegram, Reddit): no traen «título» de oferta, traen texto. Solo se aceptan las que
// OFRECEN trabajo; las de quien lo busca, las de venta de cursos y las charlas se descartan. Campos de Reddit: los reales de la prueba del 11-24.
step('posts: Reddit con título y contentUrl pero sin intención de contratar no se guarda', () => {
  const chat = { id: 'a1', title: '¿Alguien ha trabajado de closer en infoproductos?', body: 'Estoy pensando en dedicarme a ello, ¿qué os parece?', contentUrl: 'https://www.reddit.com/r/emprendedores/comments/a1/x/', authorName: 'pepe', communityName: 'emprendedores', postType: 'text' };
  assert.equal(mapItem(chat), null);
});
step('posts: una publicación que busca closer se convierte en oferta con su enlace y su texto completo, sin inventar empresa ni sueldo', () => {
  const post = { postId: '99', text: 'Buscamos closer de ventas remoto para infoproducto de alto valor. Comisión del 10% por cierre, leads cualificados. Escribe por privado.\nMás info abajo', url: 'https://www.facebook.com/groups/empleocloserdeventas/posts/99', user: { name: 'Agencia Delta' }, time: '2026-11-25T10:00:00.000Z' };
  const c = mapItem(post);
  assert.ok(c, 'se guarda');
  assert.equal(c.url, post.url); assert.equal(c.external_id, '99');
  assert.match(c.title, /^Buscamos closer de ventas remoto/); assert.ok(c.title.length <= 120);
  assert.match(c.description, /Comisión del 10%/);
  assert.equal(c.salary, null, 'un porcentaje del texto no se convierte en sueldo');
  assert.equal(c.raw.kind, 'social_post');
  assert.equal(c.posted_at, '2026-11-25T10:00:00.000Z');
});
step('posts: quien busca trabajo o vende un curso no es una oferta', () => {
  const seeker = { text: 'Soy closer con 3 años de experiencia, busco trabajo remoto. Escríbeme por privado.', url: 'https://t.me/c/1/2' };
  const course = { text: 'Aprende a ser closer en 30 días. Curso con garantía, plazas limitadas, únete al grupo ya.', url: 'https://t.me/c/1/3' };
  assert.equal(mapItem(seeker), null); assert.equal(mapItem(course), null);
});
step('posts: sin enlace no hay oferta; un texto sin rol de ventas tampoco; inglés incluido', () => {
  assert.equal(mapItem({ text: 'Buscamos closer de ventas remoto, comisión alta' }), null, 'sin enlace');
  assert.equal(mapItem({ text: 'Buscamos diseñador gráfico freelance para logos', url: 'https://t.me/c/9/9' }), null, 'rol ajeno');
  const en = mapItem({ message: 'We are hiring remote high ticket closers and setters (commission only, US leads).', permalink: 'https://www.facebook.com/groups/x/posts/5' });
  assert.ok(en, 'inglés'); assert.equal(en.url, 'https://www.facebook.com/groups/x/posts/5');
});
step('posts: una oferta de empleo normal (título, empresa, descripción) no cambia de comportamiento', () => {
  const job = { title: 'Closer de ventas', company: 'Acme', url: 'https://x.test/j/1', description: 'Buscamos closer. Comisión alta.' };
  const c = mapItem(job); assert.equal(c.title, 'Closer de ventas'); assert.equal(c.company, 'Acme'); assert.equal(c.raw.kind, undefined);
  assert.equal(mapItem({ title: 'Peluquero', company: 'Salón', url: 'https://x.test/j/2', description: 'Buscamos peluquero' }).title, 'Peluquero', 'una oferta con empresa no se filtra por rol aquí');
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
