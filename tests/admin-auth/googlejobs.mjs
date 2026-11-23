// Google Jobs (SerpApi) como fuente de closers de España.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/googlejobs.mjs
import http from 'node:http';
import assert from 'node:assert/strict';

const PORT = 8796;
let searches = [];          // peticiones a SerpApi de la última recogida
let saved = [];             // filas que el colector intentó guardar
let mode = 'ok';            // ok | fail | empty | error
let hasKey = true;
let paused = [];
let searchDelayMs = 0;
let runs = [];              // filas de external_ingest_runs (lo que el colector anota y el medidor suma)
let brightKey = false;      // ¿hay clave de Bright Data guardada?
let brightMode = 'ok';      // ok | html | error
let brightCalls = [];       // peticiones a Bright Data de la última recogida
let capRow = null;          // tope guardado en provider_budget (null = sin fila: manda el entorno)
let jsearchKey = false;     // ¿hay clave de JSearch guardada?
let jsearchMode = 'ok';     // ok | 401 | 429 | network
let jsearchCalls = [];      // peticiones a JSearch de la última recogida
const asyncStore = new Map(); // encargos asíncronos de Bright Data simulados: id → respuesta
let brightCollects = [];      // recogidas (/serp/get_result) de la última recogida
let asyncPending = false;     // Bright Data aún procesa los encargos (202)
let brightAsyncOff = false;   // la zona no tiene activado el modo asíncrono (sin x-response-id)

const job = (id, extra = {}) => ({
  job_id: id,
  title: 'Closer de ventas high ticket',
  company_name: 'Acme Formación',
  location: 'Madrid, España',
  via: 'InfoJobs',
  description: 'Buscamos closer para cerrar ventas por videollamada con leads cualificados. Fijo más comisiones.',
  share_link: `https://es.infojobs.net/oferta/${id}`,
  detected_extensions: { posted_at: 'hace 2 días', salary: '30.000 € - 45.000 € al año' },
  ...extra,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  let body = '';
  for await (const chunk of req) body += chunk;
  if (url.pathname === '/search.json') {
    searches.push(Object.fromEntries(url.searchParams));
    if (searchDelayMs) await new Promise(r => setTimeout(r, searchDelayMs));
    if (mode === 'fail') return send(500, { error: 'boom' });
    if (mode === 'error') return send(200, { error: 'Invalid API key' });
    if (mode === 'empty') return send(200, { error: "Google hasn't returned any results for this query." });
    const q = url.searchParams.get('q') ?? '';
    // El mismo anuncio aparece en dos dorks: debe quedar una sola fila. Se devuelve en todas las
    // búsquedas (no solo en la del dork «high ticket») porque la ventana de dorks rota por día: así la
    // prueba mide el dedupe y el enlace del portal cualquier día, no solo cuando toca ese término.
    void q;
    const rows = [job('job-1'), job('job-2', {
      title: 'Setter/Closer',
      share_link: 'https://www.google.com/search?q=closer+ventas&ibp=htl;jobs',
      apply_options: [{ title: 'InfoJobs', link: 'https://www.infojobs.net/oferta/job-2' }],
      detected_extensions: { posted_at: 'ayer' },
    }), job('job-2'), job('job-3', { share_link: 'javascript:alert(1)', link: null, apply_options: [] })];
    return send(200, { jobs_results: rows });
  }
  if (url.pathname === '/jsearch/search-v2') {
    jsearchCalls.push({ params: Object.fromEntries(url.searchParams), key: req.headers['x-api-key'] });
    if (jsearchMode === 'network') { req.destroy(); return; }
    if (jsearchMode === '401') return send(401, { status: 'ERROR', message: 'Invalid API key' });
    if (jsearchMode === '429') return send(429, { status: 'ERROR', message: 'Too many requests' });
    return send(200, { status: 'OK', data: { jobs: [{
      job_id: 'js-1',
      job_title: 'Closer high ticket (JSearch)',
      employer_name: 'Acme JSearch',
      job_apply_link: 'https://es.infojobs.net/oferta/js-1',
      job_location: 'Madrid, ES',
      job_description: 'Cierre de ventas por videollamada con leads cualificados.',
      job_posted_at_datetime_utc: '2026-11-20T09:00:00Z',
    }] } });
  }
  if (url.pathname === '/request' && req.method === 'POST') {
    const reply = (code, data) => [code, 'application/json', JSON.stringify(data)];
    const compute = () => {
    const payload = JSON.parse(body || '{}');
    brightCalls.push(payload);
    if (brightMode === 'error') return reply(401, { error: 'invalid api key' });
    if (brightMode === 'nopanel') return reply(200, { organic: [] });
    if (brightMode === 'list') return reply(200, { jobs: [{ title: 'Closer lista', company: 'Acme L', location: 'Madrid, España', source: 'InfoJobs', description: 'Ventas', link: `https://www.infojobs.net/oferta/bl-${brightCalls.length}` }] });
    if (brightMode === 'html' || !String(payload.url ?? '').includes('brd_json=1')) return [200, 'text/html', '<html>Google</html>'];
    return reply(200, { jobs: { items: [{ title: 'Closer BD', company: 'Acme BD', location: 'Madrid, España', source: 'InfoJobs', description: 'Ventas por videollamada', link: `https://www.infojobs.net/oferta/bd-${brightCalls.length}`, tags: [] }] } });
    };
    const [code, ctype, text] = compute();
    // Modo asíncrono: Bright Data responde enseguida con `x-response-id` (sin el resultado) si la petición es válida.
    if (url.searchParams.get('async') === 'true') {
      if (code === 401) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(text); }
      // Zona sin modo asíncrono: Bright Data responde en síncrono, sin x-response-id.
      if (brightAsyncOff) { res.writeHead(code, { 'content-type': ctype }); return res.end(text); }
      const id = `resp${asyncStore.size + 1}x`;
      asyncStore.set(id, [code, ctype, text]);
      res.writeHead(200, { 'content-type': 'application/json', 'x-response-id': id });
      return res.end(JSON.stringify({ response_id: id }));
    }
    res.writeHead(code, { 'content-type': ctype }); return res.end(text);
  }
  if (url.pathname === '/serp/get_result') {
    const id = url.searchParams.get('response_id');
    brightCollects.push(id);
    if (asyncPending) { res.writeHead(202, { 'content-type': 'text/plain' }); return res.end('Request is pending'); }
    const stored = asyncStore.get(id);
    if (!stored) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Result not found'); }
    res.writeHead(stored[0], { 'content-type': stored[1] }); return res.end(stored[2]);
  }
  if (url.pathname === '/rest/v1/integration_connections') {
    const wanted = (url.searchParams.get('provider') ?? '').replace('eq.', '');
    if (wanted === 'brightdata') return send(200, brightKey ? [{ secret_ciphertext: process.env.TEST_BD_SECRET }] : []);
    if (wanted === 'jsearch') return send(200, jsearchKey ? [{ secret_ciphertext: process.env.TEST_JS_SECRET }] : []);
    return send(200, hasKey ? [{ secret_ciphertext: process.env.TEST_SECRET }] : []);
  }
  if (url.pathname === '/rest/v1/provider_budget') return send(200, capRow ? [capRow] : []);
  if (url.pathname === '/rest/v1/source_settings') return send(200, paused.map(source => ({ source })));
  if (url.pathname === '/rest/v1/rpc/external_upsert') {
    const rows = JSON.parse(body || '{}').p_rows ?? [];
    saved = rows;
    return send(200, rows.length);
  }
  if (url.pathname === '/rest/v1/external_ingest_runs') {
    // Pagina como PostgREST: sin respetar `offset` el paginador nunca vería una página vacía.
    if (req.method === 'GET') {
      // Filtros de PostgREST que usa el registro asíncrono: source=eq.X y via=in.(a,b).
      const list = key => { const v = url.searchParams.get(key) ?? ''; const m = /^in\.\((.*)\)$/.exec(v); return m ? m[1].split(',') : v.startsWith('eq.') ? [v.slice(3)] : null; };
      const srcs = list('source'), vias = list('via');
      const rows = runs.filter(r => (!srcs || srcs.includes(r.source)) && (!vias || vias.includes(r.via)));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return send(200, rows.slice(offset, offset + Number(url.searchParams.get('limit') ?? 1000)).map(r => ({ note: r.note, via: r.via, source: r.source })));
    }
    const row = JSON.parse(body || '{}'); runs.push(row);
    return send(201, {});
  }
  return send(404, {});
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
process.env.ADMIN_SECRETS_KEY = 'test-root';
process.env.SERPAPI_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.BRIGHTDATA_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.JSEARCH_API_BASE = `http://127.0.0.1:${PORT}/jsearch`;
delete process.env.SERPAPI_JOBS_MAX_DORKS;

const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('serpapi-key-1234');
process.env.TEST_BD_SECRET = encryptSecret('bdkey-12345678:serp_zone');
process.env.TEST_JS_SECRET = encryptSecret('jsearch-key-1234');
const { collectGoogleJobs, postedAt, toCandidate, dorkWindow, DAY_MS, GOOGLE_JOBS_DORKS, DEFAULT_MAX_DORKS, SEARCH_USD } = await import('../../apps/web/lib/googleJobs.ts');
const { JSEARCH_USD_PER_REQUEST } = await import('../../apps/web/lib/providers/jsearch.ts');

const results = [];
const step = async (name, fn) => {
  searches = []; saved = []; mode = 'ok'; hasKey = true; paused = []; searchDelayMs = 0;
  runs = []; brightKey = false; brightMode = 'ok'; brightCalls = []; capRow = null; brightCollects = []; asyncPending = false; brightAsyncOff = false;
  jsearchKey = false; jsearchMode = 'ok'; jsearchCalls = [];
  delete process.env.SERPAPI_MONTHLY_USD; delete process.env.BRIGHTDATA_MONTHLY_USD;
  delete process.env.SERPAPI_JOBS_MAX_DORKS; delete process.env.JSEARCH_MONTHLY_USD;
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message.split('\n')[0]]); }
};

await step('mapea Google Jobs a candidatos con empresa, ubicación, salario, fecha y enlace', async () => {
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(out.searches, DEFAULT_MAX_DORKS);
  assert.equal(out.cost_usd, Number((DEFAULT_MAX_DORKS * SEARCH_USD).toFixed(3)));
  // Dedupe: job-1 y job-2 una vez; job-3 cae por enlace no http.
  assert.equal(out.received, 2, `recibidas ${out.received}`);
  assert.equal(out.accepted, 2);
  assert.equal(saved.length, 2);
  const row = saved.find(r => r.external_id === 'job-1');
  assert.equal(row.title, 'Closer de ventas high ticket');
  assert.equal(row.company, 'Acme Formación');
  assert.equal(row.location, 'Madrid, España');
  assert.equal(row.url, 'https://es.infojobs.net/oferta/job-1');
  assert.equal(row.salary, '30.000 € - 45.000 € al año');
  assert.match(row.description, /cerrar ventas/);
  const age = Date.now() - Date.parse(row.posted_at);
  assert.ok(age > 1.9 * 86400_000 && age < 2.1 * 86400_000, `fecha relativa: ${row.posted_at}`);
  const y = saved.find(r => r.external_id === 'job-2');
  assert.match(y.posted_at, /T/);
  // Google entrega su propia ficha (google.com/search) y el portal en apply_options:
  // gana el portal, para que la tarjeta no atribuya la oferta a Google.
  assert.equal(y.url, 'https://www.infojobs.net/oferta/job-2');
  const onlyGoogle = toCandidate({ job_id: 'g1', title: 'Closer', share_link: 'https://www.google.com/search?q=x' });
  assert.equal(onlyGoogle.url, 'https://www.google.com/search?q=x', 'sin portal, la ficha de Google es el respaldo');
  // Rol y España se calculan al entrar; la oferta llega como borrador.
  assert.equal(row.role, 'closer');
  assert.equal(row.spain, true);
});

await step('pide cada dork a Google Jobs en su país, en español y sin paginar', async () => {
  await collectGoogleJobs('test');
  assert.equal(searches.length, DEFAULT_MAX_DORKS);
  for (const search of searches) {
    assert.equal(search.engine, 'google_jobs');
    assert.equal(search.hl, 'es');
    assert.equal(search.api_key, 'serpapi-key-1234');
    assert.equal(search.next_page_token ?? null, null, 'no se paga una segunda página');
  }
  assert.deepEqual(searches.map(s => s.q), dorkWindow().map(d => d.q));
  assert.deepEqual(searches.map(s => s.gl), dorkWindow().map(d => d.gl));
  // El presupuesto por defecto cubre los dos mercados, repartido en proporción a cada lista (España y el resto, en dólares).
  const esTotal = GOOGLE_JOBS_DORKS.filter(d => d.gl === 'es').length;
  const esExpected = Math.min(esTotal, Math.max(1, Math.round((DEFAULT_MAX_DORKS * esTotal) / GOOGLE_JOBS_DORKS.length)));
  assert.equal(searches.filter(s => s.gl === 'es').length, esExpected);
  assert.equal(searches.filter(s => s.gl !== 'es').length, DEFAULT_MAX_DORKS - esExpected);
  // Qué países de LatAm entran cambia con la ventana del día; lo que no puede faltar es la cobertura:
  // España y al menos un mercado en dólares, cada dork en el `gl` que declara su vocabulario.
  assert.ok(searches.some(s => s.gl === 'es'), 'falta España en la ventana');
  assert.ok(searches.some(s => s.gl !== 'es'), 'falta LatAm en la ventana');
  for (const search of searches) assert.ok(GOOGLE_JOBS_DORKS.some(d => d.q === search.q && d.gl === search.gl));
});

await step('rota la ventana de dorks por día: mismo coste y todo el vocabulario se ejecuta', async () => {
  const seen = new Set();
  for (let day = 0; day < GOOGLE_JOBS_DORKS.length; day += 1) {
    const window = dorkWindow(day * DAY_MS);
    assert.equal(window.length, DEFAULT_MAX_DORKS, `ventana de ${window.length} dorks el día ${day}`);
    assert.equal(new Set(window.map(d => `${d.q}|${d.gl}`)).size, window.length, 'un dork (término + país) no se repite en la misma pasada');
    const esTotal = GOOGLE_JOBS_DORKS.filter(d => d.gl === 'es').length;
    const esExpected = Math.min(esTotal, Math.max(1, Math.round((DEFAULT_MAX_DORKS * esTotal) / GOOGLE_JOBS_DORKS.length)));
    assert.equal(window.filter(d => d.gl === 'es').length, esExpected, 'el reparto de España es proporcional a su lista y no cambia de un día a otro');
    assert.equal(window.filter(d => d.gl !== 'es').length, DEFAULT_MAX_DORKS - esExpected, 'el resto va a LatAm y EE. UU.');
    window.forEach(d => seen.add(`${d.q}|${d.gl}`));
  }
  assert.equal(seen.size, GOOGLE_JOBS_DORKS.length, 'en una vuelta completa se ejecutan todos los dorks');
  assert.notDeepEqual(dorkWindow(0).map(d => `${d.q}|${d.gl}`), dorkWindow(DAY_MS).map(d => `${d.q}|${d.gl}`), 'cada día cambia la ventana');
  assert.deepEqual(dorkWindow(0, GOOGLE_JOBS_DORKS.length).map(d => d.q), GOOGLE_JOBS_DORKS.map(d => d.q), 'con presupuesto para todos, el vocabulario completo');
});

await step('cobertura por país: Chile, Perú y EE. UU. en español, sin dorks repetidos, y una vuelta completa pasa por todos los países', async () => {
  const countries = new Set(GOOGLE_JOBS_DORKS.map(d => d.gl));
  for (const gl of ['es', 'mx', 'co', 'ar', 'cl', 'pe', 'us']) assert.ok(countries.has(gl), `falta el país ${gl}`);
  assert.equal(new Set(GOOGLE_JOBS_DORKS.map(d => `${d.q}|${d.gl}`)).size, GOOGLE_JOBS_DORKS.length, 'ningún dork (término + país) está repetido');
  assert.ok(GOOGLE_JOBS_DORKS.every(d => d.hl === 'es'), 'todo se busca en español');
  assert.ok(GOOGLE_JOBS_DORKS.some(d => /closer/i.test(d.q) && d.gl === 'us'), 'hay búsqueda de closer en EE. UU. hispano');
  const reached = new Set();
  for (let day = 0; day < GOOGLE_JOBS_DORKS.length; day += 1) dorkWindow(day * DAY_MS).forEach(d => reached.add(d.gl));
  assert.deepEqual([...reached].sort(), [...countries].sort(), 'con el presupuesto por defecto, la rotación llega a todos los países');
});

await step('fechas: relativas sí, desconocidas no se inventan', async () => {
  assert.equal(postedAt('hace 3 horas') !== null, true);
  assert.equal(postedAt('3 days ago') !== null, true);
  assert.equal(postedAt('30+ days ago') !== null, true);
  assert.equal(postedAt('ayer') !== null, true);
  assert.equal(postedAt('2026-10-20T09:00:00Z'), '2026-10-20T09:00:00.000Z', 'una fecha ISO se respeta, no se reinterpreta');
  assert.equal(postedAt(''), null);
  assert.equal(postedAt('publicado recientemente'), null);
  assert.equal(postedAt(undefined), null);
  const c = toCandidate({ job_id: 'x', title: 'Closer', share_link: 'https://x.es/1' });
  assert.equal(c.posted_at, null, 'sin fecha en la fuente queda desconocida');
});

await step('los dorks van en paralelo: caben en el tramo corto del cron', async () => {
  let calls = 0;
  const out = await collectGoogleJobs('test', Date.now() + 4_000, () => async () => {
    await new Promise(r => setTimeout(r, 1_500));
    calls++;
    return [toCandidate(job(`par-${calls}`))];
  });
  // En serie serían 1,5 s por dork; con un tope de 4 s se declararía el corte y se perderían los últimos.
  assert.equal(out.searches, DEFAULT_MAX_DORKS);
  assert.equal(out.truncated, undefined);
  assert.equal(out.received, DEFAULT_MAX_DORKS, `recibidas ${out.received}`);
});

await step('un dork caído no oculta los demás y se anota', async () => {
  mode = 'fail';
  // El mock falla todos; se cambia a mitad con un fetcher propio para probar el aislamiento.
  const real = await import('../../apps/web/lib/googleJobs.ts');
  const out = await real.collectGoogleJobs('test', Date.now() + 20_000, () => {
    let calls = 0;
    return async () => { calls++; if (calls === 1) throw new Error('HTTP 500'); return [toCandidate(job('ok-1'))]; };
  });
  assert.equal(out.ok, true);
  assert.equal(out.received, 1);
});

await step('un error del proveedor no se presenta como éxito', async () => {
  mode = 'error';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /SerpApi: Invalid API key/);
});

await step('el gasto de SerpApi se anota con el formato único y lo suma el medidor', async () => {
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  const { spentFromNotes, requestsFromNotes } = await import('../../apps/web/lib/providerBudget.ts');
  const notes = runs.map(r => ({ note: r.note }));
  assert.equal(spentFromNotes(notes, 'serpapi').usd, Number((DEFAULT_MAX_DORKS * SEARCH_USD).toFixed(6)), 'el marcador ve lo gastado de verdad');
  assert.equal(requestsFromNotes(notes, 'serpapi'), DEFAULT_MAX_DORKS);
  assert.deepEqual(out.by_provider, { serpapi: { searches: DEFAULT_MAX_DORKS, cost_usd: Number((DEFAULT_MAX_DORKS * SEARCH_USD).toFixed(6)) } });
});

await step('el tope mensual en USD frena las búsquedas automáticas (antes no había ninguno)', async () => {
  process.env.SERPAPI_MONTHLY_USD = '0.10'; // caben 4 búsquedas de 0,025
  const out = await collectGoogleJobs('test');
  assert.equal(searches.length, 4, `se lanzaron ${searches.length}`);
  assert.equal(out.skipped_budget, DEFAULT_MAX_DORKS - 4, 'lo que no cabe se declara');
  assert.equal(out.searches, 4);
  process.env.SERPAPI_MONTHLY_USD = '0';
  searches = []; runs = [];
  const none = await collectGoogleJobs('test');
  assert.equal(none.ok, false);
  assert.match(none.error, /Sin presupuesto/);
  assert.equal(searches.length, 0, 'con tope 0 no se gasta nada');
});

await step('lo ya gastado cuenta: con el tope casi agotado, no se lanza más', async () => {
  process.env.SERPAPI_MONTHLY_USD = '1';
  runs = [{ note: 'ruta x · proveedor=serpapi · 39 petición(es) · coste_usd=0.990000' }];
  const out = await collectGoogleJobs('test');
  assert.equal(searches.length, 0);
  assert.equal(out.ok, false);
});

await step('el tope guardado en provider_budget manda sobre el entorno', async () => {
  process.env.SERPAPI_MONTHLY_USD = '100';
  capRow = { provider: 'serpapi', monthly_usd: 0.05, updated_by: 'dueño', updated_at: '2026-11-21T10:00:00Z' };
  await collectGoogleJobs('test');
  assert.equal(searches.length, 2, 'el tope de la tabla (0,05 USD) limita a 2 búsquedas');
});

await step('una fila sembrada por la migración (sin updated_by) NO pisa el tope del entorno', async () => {
  process.env.SERPAPI_MONTHLY_USD = '0.05';
  capRow = { provider: 'serpapi', monthly_usd: 5, updated_by: null, updated_at: null }; // la semilla de provider_budget
  await collectGoogleJobs('test');
  assert.equal(searches.length, 2, 'manda el entorno (0,05 USD), no la semilla de 5 USD');
});

await step('Bright Data falla y SerpApi cubre: es un aviso, no un fallo de la fuente (aunque no haya ofertas)', async () => {
  brightKey = true; brightMode = 'error'; mode = 'empty';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.accepted, 0);
  assert.equal(out.warnings.length, DEFAULT_MAX_DORKS);
  assert.match(out.warnings[0], /Bright Data/);
  assert.ok(runs.some(r => /pasaron al siguiente proveedor/.test(r.note ?? '')), 'el aviso queda en la nota de la ejecución');
});

await step('Google sin panel de empleos con Bright Data se declara, no se confunde con «0 ofertas»', async () => {
  brightKey = true; brightMode = 'nopanel';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(out.no_jobs_panel, DEFAULT_MAX_DORKS);
  assert.equal(searches.length, 0, 'sin panel no se paga SerpApi por cada dork: se declara');
});

await step('sin gasto legible no se lanza gasto nuevo (un hueco no es un cero)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/rest/v1/external_ingest_runs') && (!init?.method || init.method === 'GET')) return new Response('{}', { status: 500 });
    return realFetch(input, init);
  };
  try {
    const out = await collectGoogleJobs('test');
    assert.equal(out.ok, false);
    assert.equal(searches.length, 0);
  } finally { globalThis.fetch = realFetch; }
});

await step('cascada: con Bright Data se usa primero (1/16 del precio) y SerpApi no se toca', async () => {
  brightKey = true;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(searches.length, 0, 'SerpApi no se llama si Bright Data responde');
  assert.equal(brightCalls.length, DEFAULT_MAX_DORKS);
  for (const call of brightCalls) {
    assert.ok(['raw', 'json'].includes(call.format));
    assert.match(call.url, /brd_json=1/);
    assert.equal(call.zone, 'serp_zone');
  }
  assert.equal(out.by_provider.brightdata.searches, DEFAULT_MAX_DORKS);
  assert.equal(out.cost_usd, Number((DEFAULT_MAX_DORKS * 0.0015).toFixed(4)));
  assert.ok(runs.some(r => /proveedor=brightdata/.test(r.note ?? '')), 'el gasto de Bright Data también se anota');
});

await step('cascada: si Bright Data devuelve HTML, cada dork pasa a SerpApi y el fallo se declara', async () => {
  brightKey = true; brightMode = 'html';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(searches.length, DEFAULT_MAX_DORKS, 'SerpApi cubre lo que Bright Data no resolvió');
  assert.equal(out.by_provider.serpapi.searches, DEFAULT_MAX_DORKS);
  assert.equal(out.by_provider.brightdata.searches, DEFAULT_MAX_DORKS, 'un 200 con HTML sí lo factura Bright Data: se anota');
});

await step('cascada: una petición que Bright Data rechaza (401) no se cobra ni se anota; SerpApi cubre', async () => {
  brightKey = true; brightMode = 'error';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(out.by_provider.brightdata, undefined, 'lo rechazado no es gasto');
  assert.equal(out.by_provider.serpapi.searches, DEFAULT_MAX_DORKS);
  assert.ok(!runs.some(r => /proveedor=brightdata/.test(r.note ?? '')), 'no hay nota de gasto de Bright Data');
});


await step('JSearch sustituye a SerpApi en los 7 dorks, a 0,0025 USD y con su propia nota', async () => {
  jsearchKey = true;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(searches.length, 0, 'SerpApi no se llama si JSearch responde');
  assert.equal(jsearchCalls.length, DEFAULT_MAX_DORKS, `JSearch recibió ${jsearchCalls.length}`);
  for (const call of jsearchCalls) {
    assert.equal(call.key, 'jsearch-key-1234', 'la clave va en x-api-key, no en la URL');
    assert.equal(call.params.num_pages, '1', 'no se paga una segunda página');
    assert.equal(call.params.language, 'es');
    assert.ok(GOOGLE_JOBS_DORKS.some(d => d.q === call.params.query && d.gl === call.params.country), `dork sin país: ${call.params.query} / ${call.params.country}`);
  }
  assert.equal(out.cost_usd, Number((DEFAULT_MAX_DORKS * JSEARCH_USD_PER_REQUEST).toFixed(4)), 'la pasada cuesta 7 × 0,0025');
  assert.deepEqual(out.by_provider.jsearch, { searches: DEFAULT_MAX_DORKS, cost_usd: Number((DEFAULT_MAX_DORKS * JSEARCH_USD_PER_REQUEST).toFixed(6)) });
  assert.equal(out.by_provider.serpapi, undefined, 'el respaldo caro no se toca');
  assert.equal(out.received, 1, 'el mismo anuncio en 7 dorks se guarda una vez');
  assert.ok(runs.some(r => /proveedor=jsearch/.test(r.note ?? '')), 'el gasto se anota con su proveedor');
  assert.ok(!runs.some(r => /proveedor=serpapi/.test(r.note ?? '')), 'y no se atribuye a SerpApi');
});

await step('el tope mensual de JSearch frena sus búsquedas y SerpApi cubre lo que no cabe', async () => {
  jsearchKey = true;
  process.env.JSEARCH_MONTHLY_USD = '0.01'; // caben 4 de 0,0025 (el tope se guarda en céntimos)
  const out = await collectGoogleJobs('test');
  assert.equal(jsearchCalls.length, 4, `JSearch lanzó ${jsearchCalls.length}`);
  assert.equal(searches.length, DEFAULT_MAX_DORKS - 4, 'el resto baja a SerpApi');
  assert.equal(out.by_provider.jsearch.searches, 4);
  assert.equal(out.by_provider.serpapi.searches, DEFAULT_MAX_DORKS - 4);
  assert.equal(out.skipped_budget, undefined, 'nada se queda sin lanzar: hay respaldo');
});

await step('un 429 de JSearch no se cobra, no se reintenta y cada dork baja a SerpApi', async () => {
  jsearchKey = true; jsearchMode = '429';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(jsearchCalls.length, DEFAULT_MAX_DORKS, 'un intento por dork y ninguno más');
  assert.equal(out.by_provider.jsearch, undefined, 'un 429 no se factura');
  assert.equal(out.by_provider.serpapi.searches, DEFAULT_MAX_DORKS);
  assert.equal(out.warnings.length, DEFAULT_MAX_DORKS);
  assert.match(out.warnings[0], /JSearch .*429.*→ SerpApi/);
  assert.match(runs.find(r => /429/.test(r.note ?? ''))?.note ?? '', /7 búsqueda\(s\) de JSearch con 429/, 'la nota declara el 429');
  assert.ok(!runs.some(r => /proveedor=jsearch/.test(r.note ?? '')), 'no hay nota de gasto de JSearch');
});

await step('un 401 de JSearch tampoco se cobra y el dork baja a SerpApi', async () => {
  jsearchKey = true; jsearchMode = '401';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(out.by_provider.jsearch, undefined);
  assert.equal(out.by_provider.serpapi.searches, DEFAULT_MAX_DORKS);
});

await step('un fallo sin respuesta de JSearch se anota como peor caso, no como gratis', async () => {
  jsearchKey = true; jsearchMode = 'network';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.by_provider.jsearch.searches, DEFAULT_MAX_DORKS, 'sin estado no se puede afirmar que no se cobró');
  assert.equal(out.by_provider.serpapi.searches, DEFAULT_MAX_DORKS, 'SerpApi sigue cubriendo el dork');
  assert.ok(runs.some(r => /proveedor=jsearch/.test(r.note ?? '')));
});

await step('cascada completa: Bright Data primero, JSearch antes que SerpApi y ningún gasto de más', async () => {
  brightKey = true; jsearchKey = true;
  const out = await collectGoogleJobs('test');
  assert.equal(out.by_provider.brightdata.searches, DEFAULT_MAX_DORKS);
  assert.equal(jsearchCalls.length, 0, 'con Bright Data no se paga JSearch');
  assert.equal(searches.length, 0);
  brightMode = 'error'; jsearchCalls = []; searches = []; runs = [];
  const second = await collectGoogleJobs('test');
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(jsearchCalls.length, DEFAULT_MAX_DORKS, 'JSearch cubre lo que Bright Data rechaza');
  assert.equal(searches.length, 0, 'y SerpApi no llega a usarse');
  assert.equal(second.by_provider.brightdata, undefined, 'el 401 de Bright Data no se cobra');
  assert.equal(second.warnings.length, DEFAULT_MAX_DORKS);
  assert.match(second.warnings[0], /Bright Data .*→ JSearch/);
});

await step('un 429 de JSearch sin SerpApi no se presenta como éxito ni se cobra', async () => {
  jsearchKey = true; jsearchMode = '429'; hasKey = false;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.equal(out.by_provider.jsearch, undefined);
  assert.match(out.error, /429/);
  assert.equal(saved.length, 0);
});

await step('síncrono: con poco tiempo en el tramo, Bright Data no se llama (se cortaría y puede cobrarse) y SerpApi cubre', async () => {
  brightKey = true; process.env.BRIGHTDATA_ASYNC = '0';
  const out = await collectGoogleJobs('test', Date.now() + 8_000);
  delete process.env.BRIGHTDATA_ASYNC;
  assert.equal(brightCalls.length, 0, 'sin ~15 s no se lanza Bright Data');
  assert.equal(searches.length, DEFAULT_MAX_DORKS, 'SerpApi cubre todos los dorks');
  assert.equal(out.by_provider.brightdata, undefined, 'no se reserva gasto de Bright Data');
  assert.ok((out.warnings ?? []).some(w => /Bright Data omitido/.test(w)), 'se dice por qué no se usó Bright Data');
});

await step('asíncrono: con poco tiempo Bright Data SÍ se usa (encargar es inmediato) y no se paga el escalón caro', async () => {
  brightKey = true;
  const out = await collectGoogleJobs('test', Date.now() + 8_000);
  assert.equal(brightCalls.length, DEFAULT_MAX_DORKS, 'un encargo por dork aunque queden 8 s');
  assert.equal(searches.length, 0, 'SerpApi no se toca');
  assert.ok(!(out.warnings ?? []).some(w => /Bright Data omitido/.test(w)));
});

await step('cascada: Bright Data con `jobs` como lista directa también se lee', async () => {
  brightKey = true; brightMode = 'list';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(searches.length, 0);
  assert.ok(saved.some(row => /Closer lista/.test(JSON.stringify(row))), 'las ofertas de la lista se guardan');
});

await step('asíncrono: si Bright Data aún procesa, no es «0 ofertas» ni se paga SerpApi; cada encargo anota su coste una vez', async () => {
  brightKey = true; asyncPending = true;
  const out = await collectGoogleJobs('test');
  assert.equal(brightCalls.length, DEFAULT_MAX_DORKS, 'un encargo por dork');
  assert.equal(searches.length, 0, 'SerpApi no se toca: el resultado llegará en la siguiente pasada');
  assert.equal(out.brightdata_async.submitted, DEFAULT_MAX_DORKS);
  assert.equal(out.brightdata_async.pending, DEFAULT_MAX_DORKS);
  assert.ok((out.warnings ?? []).some(w => /aún en proceso/.test(w)), 'lo pendiente se dice, no es «0 ofertas»');
  const spendRows = runs.filter(r => /proveedor=brightdata/.test(r.note ?? ''));
  assert.equal(spendRows.length, DEFAULT_MAX_DORKS, 'una fila de gasto por encargo, sin duplicar en la nota agregada');
  assert.ok(spendRows.every(r => r.via === 'async' && /async_id=resp\d+x/.test(r.note)), 'cada encargo guarda su async_id');
  // Siguiente pasada: Bright Data ya terminó. Recoger es gratis y guarda las ofertas.
  asyncPending = false; saved = [];
  const { collectAsync } = await import('../../apps/web/lib/brightdataAsync.ts');
  const before = runs.filter(r => /proveedor=brightdata/.test(r.note ?? '')).length;
  const got = await collectAsync('bd-key-test', { via: 'test' });
  assert.equal(got.collected, DEFAULT_MAX_DORKS, 'se recogen todos los pendientes');
  assert.ok(got.accepted > 0 && saved.length > 0, 'las ofertas recogidas se guardan');
  assert.equal(runs.filter(r => /proveedor=brightdata/.test(r.note ?? '')).length, before, 'recoger no se cobra');
  const again = await collectAsync('bd-key-test', { via: 'test' });
  assert.equal(again.checked, 0, 'lo recogido no se vuelve a pedir');
});

await step('asíncrono: si la zona no tiene el modo asíncrono, se lee su respuesta síncrona (ya cobrada) en vez de tirarla', async () => {
  brightKey = true; brightAsyncOff = true;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(searches.length, 0, 'SerpApi no hace falta');
  assert.ok(saved.some(row => /Closer BD/.test(JSON.stringify(row))), 'las ofertas de la respuesta síncrona se guardan');
  assert.equal(out.brightdata_async, undefined, 'no hay encargos pendientes');
  assert.equal(out.by_provider.brightdata.searches, DEFAULT_MAX_DORKS, 'el gasto síncrono se anota en la nota agregada');
});

await step('cascada: sin clave de SerpApi, un fallo de Bright Data se declara y no se inventa nada', async () => {
  brightKey = true; brightMode = 'html'; hasKey = false;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /no es JSON/);
});

await step('sin ninguna clave no hay recogida', async () => {
  hasKey = false;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /Sin clave guardada de SerpApi, JSearch ni de Bright Data/);
});

await step('«sin resultados» es un dork vacío, no un fallo', async () => {
  mode = 'empty';
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, true);
  assert.equal(out.received, 0);
  assert.equal(out.accepted, 0);
});

await step('sin clave de SerpApi no se llama al proveedor', async () => {
  hasKey = false;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /Sin clave guardada de SerpApi/);
  assert.equal(searches.length, 0);
});

await step('fuente pausada no gasta búsquedas', async () => {
  paused = ['google-jobs'];
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /Fuente pausada/);
  assert.equal(searches.length, 0);
});

await step('SERPAPI_JOBS_MAX_DORKS=0 la desactiva y acota el número de dorks', async () => {
  process.env.SERPAPI_JOBS_MAX_DORKS = '0';
  const off = await collectGoogleJobs('test');
  assert.equal(off.ok, false);
  assert.match(off.error, /desactivada/);
  assert.equal(searches.length, 0);
  process.env.SERPAPI_JOBS_MAX_DORKS = '1';
  searches = [];
  const one = await collectGoogleJobs('test');
  assert.equal(one.searches, 1);
  assert.equal(searches.length, 1);
  process.env.SERPAPI_JOBS_MAX_DORKS = '99';
  searches = [];
  const capped = await collectGoogleJobs('test');
  assert.equal(capped.searches, GOOGLE_JOBS_DORKS.length, 'no puede superar los dorks definidos');
});

await step('sin tiempo se corta y se declara, sin gastar', async () => {
  const out = await collectGoogleJobs('test', Date.now() + 100);
  assert.equal(out.truncated, true);
  assert.equal(out.searches, 0);
  assert.equal(searches.length, 0);
  assert.match(out.error ?? '', /Sin tiempo/);
});

await step('el coste se declara en dólares, no se oculta', async () => {
  const out = await collectGoogleJobs('test');
  assert.equal(typeof out.cost_usd, 'number');
  assert.equal(out.cost_usd, Number((DEFAULT_MAX_DORKS * SEARCH_USD).toFixed(3)));
});

server.close();
for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
