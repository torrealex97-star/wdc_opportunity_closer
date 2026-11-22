import { decryptSecret, encryptSecret } from './secrets';
import { serviceRest } from './supabaseAuth';
import { recordSpend, runsThisMonth } from './external';
import { canSpend, PROVIDER_METERS, spendNote, spentFromNotes, type MeteredProvider } from './providerBudget';
import { capForOrg } from './providerBudgetStore';
import { markDone, rememberSubmit } from './brightdataAsync';
import { RAPIDAPI_JOB_APIS, rapidApiJobs, rapidApiUsdPerRequest, type RapidApiError } from './providers/rapidapi';
import { clearBrightDataZoneCache, parseBrightDataSecret, resolveBrightDataConfig, serpProbeRequest, unwrapPayload, describeResponse, extractJobItems, brightAsyncEnabled, googleJobsUrl, JOBS_URL_VARIANTS, jobsUrlVariant, type JobsUrlVariant, type BrightDataConfig, parseSerpJobs, serpCollectAsync, serpSubmitAsync, type BrightDataZone } from './providers/brightdata';

// Conexiones con proveedores externos. Las comprobaciones usan SOLO endpoints gratuitos que no gastan
// crédito (listar modelos, ver cuenta): probar una conexión nunca cuesta dinero. Guardar una clave no
// activa gasto: el motor cloud público no usa proveedores de pago (se activan aparte, con orden explícita).
const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });
const basic = (id: string, secret: string) => ({ Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` });
const pair = (k: string) => { const i = k.indexOf(':'); return i > 0 ? [k.slice(0, i), k.slice(i + 1)] as const : null; };
const get = (url: string, headers?: Record<string, string>) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), headers });

// `probe` hace una llamada gratuita o de coste nulo; `hint` explica el formato de la clave en el panel.
export const PROVIDERS = {
  apify: { name: 'Apify', hint: 'Token de API', probe: (k: string) => get(`${process.env.APIFY_API_BASE ?? 'https://api.apify.com'}/v2/users/me`, bearer(k)) },
  serpapi: { name: 'SerpApi', hint: 'API key', probe: (k: string) => get(`${process.env.SERPAPI_API_BASE ?? 'https://serpapi.com'}/account.json?api_key=${encodeURIComponent(k)}`) },
  groq: { name: 'Groq', hint: 'API key', probe: (k: string) => get(`${process.env.GROQ_API_BASE ?? 'https://api.groq.com'}/openai/v1/models`, bearer(k)) },
  openai: { name: 'OpenAI', hint: 'API key', probe: (k: string) => get(`${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/models`, bearer(k)) },
  adzuna: { name: 'Adzuna', hint: 'app_id:app_key (separados por dos puntos)', probe: (k: string) => { const p = pair(k); return p ? get(`${process.env.ADZUNA_API_BASE ?? 'https://api.adzuna.com'}/v1/api/jobs/es/search/1?app_id=${encodeURIComponent(p[0])}&app_key=${encodeURIComponent(p[1])}&results_per_page=1`) : Promise.resolve(new Response(null, { status: 400 })); } },
  jooble: { name: 'Jooble', hint: 'Clave de es.jooble.org (España)', probe: (k: string) => fetch(`${process.env.JOOBLE_API_BASE ?? 'https://es.jooble.org'}/api/${encodeURIComponent(k)}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: 'closer', location: 'España', page: 1 }) }) },
  infojobs: { name: 'InfoJobs', hint: 'client_id:client_secret (separados por dos puntos)', probe: (k: string) => { const p = pair(k); return p ? get(`${process.env.INFOJOBS_API_BASE ?? 'https://api.infojobs.net'}/api/9/offer?maxResults=1`, basic(p[0], p[1])) : Promise.resolve(new Response(null, { status: 400 })); } },
  resend: { name: 'Resend', hint: 'API key (empieza por re_)', probe: (k: string) => get(`${process.env.RESEND_API_BASE ?? 'https://api.resend.com'}/domains`, bearer(k)) },
  // Bright Data: se pega solo la API key (Cuenta → API keys); las zonas se descubren con
  // `GET /zone/get_active_zones`, que es gratis, y también se acepta `API key:zona SERP[:zona Unlocker]`
  // para fijarlas a mano. Aquí no hay `probe`: su prueba necesita validar la clave y la zona ANTES de
  // gastar, así que vive en `testBrightDataConnection` (una sola ruta, no dos que puedan divergir).
  brightdata: {
    name: 'Bright Data',
    hint: 'API key (la zona SERP se detecta sola); también API key:zona SERP[:zona Unlocker]',
  },
  // JSearch (OpenWeb Ninja): no hay endpoint de cuenta gratuito, así que «Probar» hace UNA búsqueda real
  // (~0,0025 USD) y se anota; sin tope legible no se lanza (lo hace `testConnection`).
  jsearch: { name: 'JSearch', hint: 'API key de OpenWeb Ninja', probe: (k: string) => get(`${(process.env.JSEARCH_API_BASE ?? 'https://api.openwebninja.com/jsearch').replace(/\/+$/, '')}/search-v2?query=${encodeURIComponent('closer de ventas España')}&country=es&language=es&num_pages=1`, { 'x-api-key': k }) },
  // RapidAPI: UNA clave para todas las APIs de empleo del marketplace a las que te suscribas. «Probar» hace una
  // búsqueda en cada API verificada (JSearch, Jobs API LinkedIn e Indeed) y dice a cuáles estás suscrito; vive en
  // `testRapidApiConnection` porque son varias peticiones, cada una con su anotación de gasto.
  rapidapi: { name: 'RapidAPI', hint: 'X-RapidAPI-Key (una clave para todas las APIs de empleo a las que te suscribas)' },
  // ZenRows y ScrapingBee: una página de prueba por el proxy. También cuesta una petición (~0,002 USD).
  zenrows: { name: 'ZenRows', hint: 'API key de ZenRows', probe: (k: string) => get(`https://api.zenrows.com/v1/?apikey=${encodeURIComponent(k)}&url=${encodeURIComponent('https://example.com')}`) },
  scrapingbee: { name: 'ScrapingBee', hint: 'API key de ScrapingBee', probe: (k: string) => get(`https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(k)}&url=${encodeURIComponent('https://example.com')}`) },
} as const;

/** Proveedores cuya prueba hace una petición real y se cobra (se avisa en la tarjeta). */
export const SPEND_PROBES: ReadonlySet<Provider> = new Set<Provider>(['brightdata', 'jsearch', 'rapidapi', 'zenrows', 'scrapingbee']);
export type Provider = keyof typeof PROVIDERS;
// `in` también acepta nombres heredados del prototipo (`toString`, `constructor`): se comprueba que la clave
// sea propia, o el panel guardaría filas para un proveedor que no existe.
export const isProvider = (v: unknown): v is Provider =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, v);

export type ConnectionRow = { provider: Provider; last4: string; updated_by: string; updated_at: string; last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null };

export async function listConnections(): Promise<ConnectionRow[] | null> {
  const response = await serviceRest('integration_connections?select=provider,last4,updated_by,updated_at,last_test_at,last_test_ok,last_test_detail');
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

/** Últimos 4 de la CLAVE, no de la zona: Bright Data se guarda como `API key:zona SERP[:zona Unlocker]`. */
const last4Of = (provider: Provider, secret: string) =>
  (provider === 'brightdata' ? secret.split(':')[0] : secret).slice(-4);

export async function saveConnection(provider: Provider, secret: string, by: string): Promise<boolean> {
  const response = await serviceRest('integration_connections?on_conflict=provider', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ provider, secret_ciphertext: encryptSecret(secret), last4: last4Of(provider, secret), updated_by: by, updated_at: new Date().toISOString(), last_test_at: null, last_test_ok: null, last_test_detail: null }),
  });
  // Clave nueva (o zonas nuevas en Bright Data): la caché de zonas del panel no puede seguir sirviendo la anterior.
  if (response.ok && provider === 'brightdata') clearBrightDataZoneCache();
  return response.ok;
}

export async function deleteConnection(provider: Provider): Promise<boolean> {
  const ok = (await serviceRest(`integration_connections?provider=eq.${provider}`, { method: 'DELETE' })).ok;
  if (ok && provider === 'brightdata') clearBrightDataZoneCache();
  return ok;
}

export async function getSecret(provider: Provider): Promise<string | null> {
  const response = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = response.ok ? await response.json().catch(() => []) : [];
  try { return Array.isArray(rows) && rows[0] ? decryptSecret(rows[0].secret_ciphertext) : null; } catch { return null; }
}

const describeZones = (zones: BrightDataZone[]) =>
  zones.length ? zones.map(zone => `${zone.name} (${zone.type ?? 'tipo no indicado'})`).join(', ') : 'ninguna';

/**
 * Prueba de Bright Data en dos pasos: primero valida clave y zona con la API de cuenta (`GET
 * /zone/get_active_zones`, gratis) y solo después hace la búsqueda real que se cobra. Antes se exigía el
 * formato `API key:zona SERP` y cualquier fallo se anunciaba como «clave rechazada», incluso con la clave
 * correcta: ahora se acepta la API key sola y cada fallo declara su causa (clave, zona o respuesta).
 */
async function testBrightDataConnection(secret: string): Promise<{ ok: boolean; detail: string }> {
  const parsed = parseBrightDataSecret(secret);
  if (!parsed) return { ok: false, detail: 'Formato incorrecto: pega la API key de Bright Data (vale también API key:zona SERP).' };
  // «Probar» es una comprobación explícita: pregunta a la cuenta aunque haya zonas en caché.
  const resolved = await resolveBrightDataConfig(secret, { useCache: false });
  // Una zona fijada a mano que la cuenta no tiene se declara sin gastar crédito.
  if (resolved.zones && parsed.serpZone && !resolved.zones.some(zone => zone.name === parsed.serpZone)) {
    return { ok: false, detail: `La clave es válida, pero la zona «${parsed.serpZone}» no está activa. Zonas de la cuenta: ${describeZones(resolved.zones)}.` };
  }
  // `resolved.config` solo es nulo cuando el texto no parsea (ya descartado arriba); la comprobación la
  // exige el tipo, no un caso real.
  const config = resolved.config;
  if (!config) return { ok: false, detail: 'Formato incorrecto: pega la API key de Bright Data.' };
  if (!config.serpZone) {
    return {
      ok: false,
      detail: resolved.error
        ? `La clave tiene el formato correcto, pero no se pudieron leer las zonas activas (${resolved.error}). Pega la clave como API key:zona SERP.`
        : 'La clave es válida, pero la cuenta no tiene una zona SERP activa: crea la de SERP API en Bright Data y vuelve a probar.',
    };
  }
  const zone = resolved.zones?.find(item => item.name === config.serpZone);
  if (zone?.type && !/^serp/i.test(zone.type)) {
    return { ok: false, detail: `La zona «${config.serpZone}» es de tipo ${zone.type}, no SERP: Google Jobs solo responde por una zona SERP API. Zonas: ${describeZones(resolved.zones ?? [])}.` };
  }
  // La búsqueda real se cobra: tope e historial primero, igual que en cualquier otro gasto.
  const runs = await runsThisMonth();
  const spent = runs === null ? null : (spentFromNotes(runs.map(run => ({ note: run.note })), 'brightdata').usd ?? 0);
  // Una sola petición: la prueba no reintenta, así que se reserva exactamente una.
  const cap = await capForOrg('brightdata');
  const check = canSpend('brightdata', spent, process.env, 1, cap.usd);
  if (!check.ok) return { ok: false, detail: check.reason ?? 'No se puede gastar ahora.' };
  // Se prueban las variantes de URL por orden y se para en la primera que trae el bloque de empleos (como mucho 3
  // peticiones). El mensaje dice cuál funcionó; si no es la primera, la recogida necesita BRIGHTDATA_JOBS_URL.
  const tried: string[] = [];
  for (const variant of JOBS_URL_VARIANTS) {
    const result = await probeVariant(config as BrightDataConfig & { serpZone: string }, variant);
    if (result.noPanel) { tried.push(`${VARIANT_LABEL[variant]}: ${result.detail}`); continue; }
    const tag = variant === jobsUrlVariant() ? '' : ` · funcionó con la variante «${VARIANT_LABEL[variant]}»: pon BRIGHTDATA_JOBS_URL=${variant} para que la recogida la use`;
    return { ok: result.ok, detail: `${result.detail}${result.ok ? tag : ''}${tried.length ? ` (antes, sin empleos: ${tried.join(' | ')})` : ''}` };
  }
  return { ok: false, detail: `La clave y la zona funcionan, pero ninguna forma de pedir Google Jobs trajo empleos: ${tried.join(' | ')}. Prueba la misma búsqueda en el Playground de Bright Data y pásame el JSON.` };
}

const VARIANT_LABEL: Record<JobsUrlVariant, string> = { search: 'búsqueda normal con «empleo»', udm8: 'pestaña Empleos (udm=8)', ibp: 'vista Google Jobs (ibp)' };

async function probeVariant(config: BrightDataConfig & { serpZone: string }, variant: JobsUrlVariant): Promise<{ ok: boolean; detail: string; noPanel?: boolean }> {
  // Modo asíncrono (el que usa la recogida): encargar es inmediato y recoger es gratis. Se consulta cada pocos
  // segundos hasta ~35 s; si aún procesa, la clave, la zona y el modo asíncrono quedan comprobados y el resultado lo
  // recoge la siguiente pasada (ya anotado). Si la zona no admite el modo asíncrono se sigue con la llamada normal.
  let asyncNote = '';
  if (brightAsyncEnabled()) {
    const dork = { q: 'closer de ventas', gl: 'es', hl: 'es' };
    let id: string | null = null;
    let direct: string | null = null;
    try {
      const submitted = await serpSubmitAsync({ ...config, serpZone: config.serpZone }, googleJobsUrl(dork.q, dork.gl, dork.hl, variant));
      if ('id' in submitted) id = submitted.id; else direct = submitted.text;
    } catch (err) { asyncNote = ` (modo asíncrono no disponible: ${(err as Error).message}; se probó en modo normal)`; }
    if (direct !== null) {
      // La zona respondió en síncrono (cobrado): se anota y se lee esa respuesta.
      const cost = PROVIDER_METERS.brightdata.usdPerRequest;
      const noted = await recordSpend('brightdata-probe', 'probe', spendNote({ route: 'prueba', provider: 'brightdata', requests: 1, costUsd: cost, detail: 'prueba de clave' }));
      if (!noted) return { ok: false, detail: 'La clave respondió, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
      try {
        const parsedDirect = parseSerpJobs(direct);
        return parsedDirect.hasJobsPanel
          ? { ok: true, detail: `Clave válida · ${parsedDirect.candidates.length} ofertas de Google Jobs (la zona no está en modo asíncrono: respondió en síncrono; 1 petición anotada)` }
          : { ok: false, noPanel: true, detail: `sin bloque de empleos (${describeResponse(direct)})` };
      } catch (err) { return { ok: false, detail: `${(err as Error).message}.` }; }
    }
    if (id) {
      const recorded = await rememberSubmit(id, dork, 'prueba');
      if (!recorded) return { ok: false, detail: 'Bright Data aceptó la búsqueda, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
      const started = Date.now();
      for (const wait of probeWaits()) {
        await new Promise(resolve => setTimeout(resolve, wait));
        const got = await serpCollectAsync(config.apiKey, id, { timeoutMs: 8_000 });
        if (got.status === 'pending') continue;
        if (got.status !== 'ready') return { ok: false, detail: `Bright Data aceptó la búsqueda asíncrona, pero al recogerla: ${got.detail}` };
        let parsedAsync: ReturnType<typeof parseSerpJobs>;
        try { parsedAsync = parseSerpJobs(got.text); }
        catch (err) { await markDone(id, `ilegible: ${(err as Error).message}`); return { ok: false, detail: `${(err as Error).message}. Lo que llegó: ${describeResponse(got.text)}.` }; }
        await markDone(id, `recogido · ${parsedAsync.candidates.length} ofertas (prueba)`);
        const secs = Math.round((Date.now() - started) / 1000);
        return parsedAsync.hasJobsPanel
          ? { ok: true, detail: `Clave válida · modo asíncrono · ${parsedAsync.candidates.length} ofertas de Google Jobs en ~${secs} s (1 petición, ${PROVIDER_METERS.brightdata.usdPerRequest.toFixed(4).replace('.', ',')} USD anotada)` }
          : { ok: false, noPanel: true, detail: `sin bloque de empleos (${describeResponse(got.text)})` };
      }
      return { ok: true, detail: `Clave y zona válidas · modo asíncrono activo: Bright Data aceptó la búsqueda y aún la procesa (suele tardar hasta 5 min). El resultado se recoge solo en la próxima recogida, sin volver a pagar.` };
    }
  }
  let response: Response;
  try {
    response = await serpProbeRequest({ ...config, serpZone: config.serpZone }, fetch, variant);
  } catch (err) {
    // Un timeout o un corte de red pudo facturarse sin respuesta: se anota el peor caso para que el tope
    // no quede corto, igual que en «Probar ruta».
    const recorded = await recordSpend('brightdata-probe', 'probe', spendNote({ route: 'prueba', provider: 'brightdata', requests: 1, costUsd: PROVIDER_METERS.brightdata.usdPerRequest, detail: 'prueba de clave · fallo de red' }));
    return { ok: false, detail: `No se pudo contactar con Bright Data: ${(err as Error).message}${recorded ? ' · se anotó 1 petición como posible gasto' : ' · no se pudo anotar el posible gasto; revisa el historial antes de reintentar'}` };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text.slice(0, 160);
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const message = [body.error, body.detail, body.message].find(value => typeof value === 'string') as string | undefined;
      if (message) detail = message.slice(0, 160);
    } catch { /* respuesta sin JSON: se enseña el texto tal cual */ }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: `Bright Data rechazó la clave (HTTP ${response.status})${detail ? `: ${detail}` : ''}` };
    }
    return { ok: false, detail: `Bright Data respondió HTTP ${response.status}${detail ? `: ${detail}` : ''} (la clave y la zona sí pasaron la comprobación de cuenta).` };
  }
  // El 200 ya se pagó aunque el cuerpo no sirva: se anota SIEMPRE antes de validar el contenido.
  const cost = PROVIDER_METERS.brightdata.usdPerRequest;
  const recorded = await recordSpend('brightdata-probe', 'probe', spendNote({ route: 'prueba', provider: 'brightdata', requests: 1, costUsd: cost, detail: 'prueba de clave' }));
  let payload: Record<string, unknown> | null = null;
  const rawText = await response.text().catch(() => '');
  try {
    const unwrapped = unwrapPayload(JSON.parse(rawText));
    payload = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped) ? unwrapped as Record<string, unknown> : null;
  } catch { /* cuerpo sin JSON */ }
  let parsedAll: unknown = null;
  try { parsedAll = JSON.parse(rawText); } catch { /* sin JSON */ }
  const extracted = extractJobItems(parsedAll);
  const jobs = extracted.panel ? extracted.items : null;
  if (!recorded) return { ok: false, detail: 'La clave respondió, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
  if (typeof payload?.error === 'string' && payload.error) return { ok: false, detail: `Bright Data: ${payload.error.slice(0, 160)}` };
  if (!Array.isArray(jobs)) return { ok: false, noPanel: true, detail: `sin bloque de empleos (${describeResponse(rawText)})` };
  return { ok: true, detail: `Clave válida · ${jobs.length} ofertas de Google Jobs · 1 petición de prueba (${cost.toFixed(4).replace('.', ',')} USD anotada)${asyncNote}` };
}

/** Esperas entre consultas de «Probar» asíncrono (~35 s en total). `BRIGHTDATA_PROBE_WAITS_MS` las acorta en pruebas. */
const probeWaits = (): number[] => {
  const raw = (process.env.BRIGHTDATA_PROBE_WAITS_MS ?? '').split(',').map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 20_000);
  return raw.length ? raw.slice(0, 8) : [8_000, 7_000, 7_000, 7_000, 6_000];
};

/**
 * «Probar» RapidAPI: una búsqueda en cada API de empleo verificada. Cada petición pasa por el tope mensual y se anota
 * al responder (aunque responda error: el plan pudo contarla). Dice a qué APIs está suscrita la clave y cuántas
 * ofertas trajo cada una; 403 = no suscrito (no se cobra), no «clave mala».
 */
async function testRapidApiConnection(secret: string): Promise<{ ok: boolean; detail: string }> {
  const key = secret.trim();
  if (key.length < 10) return { ok: false, detail: 'Formato incorrecto: pega la X-RapidAPI-Key de tu aplicación en RapidAPI.' };
  const runs = await runsThisMonth();
  let spent = runs === null ? null : (spentFromNotes(runs.map(run => ({ note: run.note })), 'rapidapi').usd ?? 0);
  const cap = await capForOrg('rapidapi');
  const price = rapidApiUsdPerRequest();
  const lines: string[] = [];
  let working = 0, rejected = false;
  for (const api of RAPIDAPI_JOB_APIS) {
    const check = canSpend('rapidapi', spent, process.env, 1, cap.usd);
    if (!check.ok) { lines.push(`${api.label}: no probado (${check.reason ?? 'sin tope'})`); continue; }
    try {
      const result = await rapidApiJobs(key, api, 'closer de ventas', 'es');
      working++;
      lines.push(`${api.label}: suscrito · ${result.candidates.length} ofertas`);
      spent = (spent ?? 0) + price;
      await recordSpend(`rapidapi-${api.id}`, 'probe', spendNote({ route: 'prueba', provider: 'rapidapi', requests: 1, costUsd: price, detail: `prueba ${api.id}` }));
    } catch (err) {
      const e = err as RapidApiError;
      if (e.status === 401) rejected = true;
      lines.push(e.message);
      if (e.billed) { spent = (spent ?? 0) + price; await recordSpend(`rapidapi-${api.id}`, 'probe', spendNote({ route: 'prueba', provider: 'rapidapi', requests: 1, costUsd: price, detail: `prueba ${api.id} · error` })); }
    }
  }
  if (rejected) return { ok: false, detail: `RapidAPI rechazó la clave (HTTP 401). ${lines.join(' · ')}` };
  return working
    ? { ok: true, detail: `Clave válida · ${working} de ${RAPIDAPI_JOB_APIS.length} APIs de empleo responden · ${lines.join(' · ')}` }
    : { ok: false, detail: `La clave no tiene ninguna API de empleo suscrita que responda: ${lines.join(' · ')}` };
}

export async function testConnection(provider: Provider): Promise<{ ok: boolean; detail: string } | null> {
  const row = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = row.ok ? await row.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows[0]) return null;
  let outcome: { ok: boolean; detail: string } = { ok: false, detail: 'No se pudo probar el proveedor.' };
  try {
    const secret = decryptSecret(rows[0].secret_ciphertext);
    if (provider === 'brightdata') {
      outcome = await testBrightDataConnection(secret);
    } else if (provider === 'rapidapi') {
      outcome = await testRapidApiConnection(secret);
    } else if (SPEND_PROBES.has(provider)) {
      const meter = provider as MeteredProvider;
      // La prueba hace una petición real: antes de lanzarla se comprueba el tope y, si responde, se anota
      // el gasto en `external_ingest_runs` para que el marcador lo sume. Sin nota no se da por contado.
      const runs = await runsThisMonth();
      const spent = runs === null ? null : (spentFromNotes(runs.map(run => ({ note: run.note })), meter).usd ?? 0);
      const cap = await capForOrg(meter);
      const check = canSpend(meter, spent, process.env, 1, cap.usd);
      if (!check.ok) {
        outcome = { ok: false, detail: check.reason ?? 'No se puede gastar ahora.' };
      } else {
        const response = await PROVIDERS[provider].probe(secret);
        if (!response.ok) {
          outcome = response.status === 401 || response.status === 403
            ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
            : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
        } else {
          // El HTTP 200 ya se pagó aunque el cuerpo no sirva: se anota SIEMPRE antes de validar.
          const cost = PROVIDER_METERS[meter].usdPerRequest;
          const recorded = await recordSpend(`${provider}-probe`, 'probe', spendNote({ route: 'prueba', provider: meter, requests: 1, costUsd: cost, detail: 'prueba de clave' }));
          outcome = recorded
            ? { ok: true, detail: `Clave válida · 1 petición de prueba (${cost.toFixed(4).replace('.', ',')} USD anotada)` }
            : { ok: false, detail: 'La clave respondió, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
        }
      }
    } else {
      const response = await PROVIDERS[provider].probe(secret);
      // Una clave de Resend restringida a «solo envío» es válida pero no puede listar dominios: responde 401 `restricted_api_key`.
      const restricted = provider === 'resend' && response.status === 401 && (await response.clone().json().catch(() => null))?.name === 'restricted_api_key';
      outcome = response.status === 400 && (provider === 'adzuna' || provider === 'infojobs') ? { ok: false, detail: 'Formato de clave incorrecto (usa id:clave)' }
        : restricted ? { ok: true, detail: 'Clave válida (permiso solo de envío)' }
        : response.ok ? { ok: true, detail: 'Clave válida' }
        : response.status === 401 || response.status === 403 ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
        : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
    }
  } catch { outcome = { ok: false, detail: 'No se pudo contactar con el proveedor' }; }
  await serviceRest(`integration_connections?provider=eq.${provider}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_test_at: new Date().toISOString(), last_test_ok: outcome.ok, last_test_detail: outcome.detail }),
  });
  return outcome;
}
