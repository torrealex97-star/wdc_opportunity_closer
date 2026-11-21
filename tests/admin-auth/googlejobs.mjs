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
  if (url.pathname === '/request' && req.method === 'POST') {
    const payload = JSON.parse(body || '{}');
    brightCalls.push(payload);
    if (brightMode === 'error') return send(401, { error: 'invalid api key' });
    if (brightMode === 'html' || !String(payload.url ?? '').includes('brd_json=1')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>Google</html>'); }
    return send(200, { jobs: { items: [{ title: 'Closer BD', company: 'Acme BD', location: 'Madrid, España', source: 'InfoJobs', description: 'Ventas por videollamada', link: `https://www.infojobs.net/oferta/bd-${brightCalls.length}`, tags: [] }] } });
  }
  if (url.pathname === '/rest/v1/integration_connections') {
    const wanted = (url.searchParams.get('provider') ?? '').replace('eq.', '');
    if (wanted === 'brightdata') return send(200, brightKey ? [{ secret_ciphertext: process.env.TEST_BD_SECRET }] : []);
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
    if (req.method === 'GET') return send(200, runs.slice(Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('offset') ?? 0) + Number(url.searchParams.get('limit') ?? 1000)).map(r => ({ note: r.note })));
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
delete process.env.SERPAPI_JOBS_MAX_DORKS;

const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
process.env.TEST_SECRET = encryptSecret('serpapi-key-1234');
process.env.TEST_BD_SECRET = encryptSecret('bdkey-12345678:serp_zone');
const { collectGoogleJobs, postedAt, toCandidate, dorkWindow, DAY_MS, GOOGLE_JOBS_DORKS, DEFAULT_MAX_DORKS, SEARCH_USD } = await import('../../apps/web/lib/googleJobs.ts');

const results = [];
const step = async (name, fn) => {
  searches = []; saved = []; mode = 'ok'; hasKey = true; paused = []; searchDelayMs = 0;
  runs = []; brightKey = false; brightMode = 'ok'; brightCalls = []; capRow = null;
  delete process.env.SERPAPI_MONTHLY_USD; delete process.env.BRIGHTDATA_MONTHLY_USD;
  delete process.env.SERPAPI_JOBS_MAX_DORKS;
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
  // El presupuesto por defecto cubre los dos mercados: 4 dorks de España y 3 de LatAm (dólares).
  assert.equal(searches.filter(s => s.gl === 'es').length, 4);
  assert.equal(searches.filter(s => s.gl !== 'es').length, 3);
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
    assert.equal(new Set(window.map(d => d.q)).size, window.length, 'un dork no se repite en la misma pasada');
    assert.equal(window.filter(d => d.gl === 'es').length, 4, 'el reparto de España se mantiene');
    assert.equal(window.filter(d => d.gl !== 'es').length, 3, 'el reparto de LatAm se mantiene');
    window.forEach(d => seen.add(d.q));
  }
  assert.equal(seen.size, GOOGLE_JOBS_DORKS.length, 'en una vuelta completa se ejecutan todos los dorks');
  assert.notDeepEqual(dorkWindow(0).map(d => d.q), dorkWindow(DAY_MS).map(d => d.q), 'cada día cambia la ventana');
  assert.deepEqual(dorkWindow(0, GOOGLE_JOBS_DORKS.length).map(d => d.q), GOOGLE_JOBS_DORKS.map(d => d.q), 'con presupuesto para todos, el vocabulario completo');
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
    assert.equal(call.format, 'raw');
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
});

await step('cascada: sin clave de SerpApi, un fallo de Bright Data se declara y no se inventa nada', async () => {
  brightKey = true; brightMode = 'html'; hasKey = false;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /HTML y no el JSON parseado/);
});

await step('sin ninguna clave no hay recogida', async () => {
  hasKey = false;
  const out = await collectGoogleJobs('test');
  assert.equal(out.ok, false);
  assert.match(out.error, /Sin clave guardada de SerpApi ni de Bright Data/);
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
