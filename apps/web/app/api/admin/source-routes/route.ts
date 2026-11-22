import { NextRequest } from 'next/server';
import { authenticate, originBlocked, publicBaseUrl, withCookies } from '../../../../lib/adminAuth';
import { collectAll, type ApiProvider } from '../../../../lib/collectors';
import { getSecret, listConnections } from '../../../../lib/integrations';
import { ingest, recordSpend, routeOrders, runsThisMonth, setSourceRouteOrder } from '../../../../lib/external';
import { toCandidate as serpCandidate } from '../../../../lib/googleJobs';
import { extractJobPostings } from '../../../../lib/jobPosting';
import { canSpend, PROVIDER_METERS, spendNote, spentFromNotes, type Cap, type MeteredProvider } from '../../../../lib/providerBudget';
import { readCaps } from '../../../../lib/providerBudgetStore';
import { BrightDataError, brightDataSource, resolveBrightDataConfig, serpJobs } from '../../../../lib/providers/brightdata';
import { JSearchError, jsearchJobs } from '../../../../lib/providers/jsearch';
import { fetchHtml } from '../../../../lib/providers/unlocker';
import { PORTALS } from '../../../../lib/apifyCatalog';
import { monthSpent } from '../../../../lib/apify';
import { searchPortal } from '../../../../lib/apifyAuto';
import { readBudget } from '../../../../lib/paidBudget';
import { ENGINE_STATUS_TEXT, engineBase, engineGet } from '../../../../lib/engineHealth';
import { routeReadiness, routesForCatalog, type RouteState } from '../../../../lib/sourceRoutes';
import sourceCatalog from '../../../../lib/sourceCatalog.json';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Rutas por fuente: resumen de gasto/topes para el panel y «Probar ruta» con una sola llamada.
// Reglas: solo el propietario prueba; sin clave no se llama; sin tope legible no se gasta; cada gasto se
// anota en `external_ingest_runs` (nota `proveedor=… · coste_usd=…`) y se ingiere por la huella de siempre.
type Entry = { code: string; name: string; website: string | null; requires: string | null; acquisition_method: string | null; category: string | null };
const CATALOG = sourceCatalog as Entry[];
const BY_SOURCE = routesForCatalog(CATALOG);

async function gate(request: NextRequest, ownerOnly = false) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede probar una ruta.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

/** Un 2xx se cobra aunque el cuerpo no sirva; un 429/5xx o un fallo antes de enviar, no. */
const billed = (status: number | null) => status === null || (status >= 200 && status < 300);

const hostOf = (value: string | null) => {
  if (!value) return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, '') : null; } catch { return null; }
};

type RunNote = { note: string | null };

/** Gasto acumulado del proveedor; `null` solo si el historial no se pudo leer (no es 0). */
const spentOf = (rows: RunNote[] | null, provider: MeteredProvider): number | null =>
  rows === null ? null : (spentFromNotes(rows.map(row => ({ note: row.note })), provider).usd ?? 0);

/**
 * Estado de claves y saldo. `rows === null` es «no se pudo leer el historial»; una lista vacía es
 * «no hay gasto todavía» y vale 0. Antes se confundían: con la primera clave guardada el panel decía
 * «no se pudo leer lo gastado» y no dejaba probar ninguna ruta.
 */
async function stateOf(rows: RunNote[] | null, caps: Record<MeteredProvider, Cap>): Promise<RouteState> {
  const notes = (rows ?? []).map(row => ({ note: row.note }));
  const spent = (provider: MeteredProvider) => rows === null ? null : (spentFromNotes(notes, provider).usd ?? 0);
  const remaining = (provider: MeteredProvider) => {
    const used = spent(provider);
    return used === null ? null : Math.max(0, caps[provider].usd - used);
  };
  const [connections, brightdataSecret, apifyLimit, apifySpent] = await Promise.all([listConnections(), getSecret('brightdata'), readBudget().catch(() => null), monthSpent().catch(() => null)]);
  const apifyLeft = apifyLimit && apifySpent !== null ? Math.max(0, apifyLimit.usd - apifySpent) : null;
  const keys = new Set((connections ?? []).map(row => row.provider));
  // Si la clave se guardó sola (el formato que da Bright Data), las zonas se descubren en la cuenta, gratis;
  // sin esa consulta la vía Unlocker parecería no estar lista teniendo su zona. `resolveBrightDataConfig`
  // guarda el resultado 10 minutos en el proceso, así que una carga del panel no repite la llamada (y
  // guardar la clave tira la caché).
  const brightdataConfig = brightdataSecret ? (await resolveBrightDataConfig(brightdataSecret, { timeoutMs: 6_000 })).config : null;
  return {
    keys,
    paused: false,
    budget: {
      brightdata: remaining('brightdata'),
      jsearch: remaining('jsearch'),
      serpapi: remaining('serpapi'),
      zenrows: remaining('zenrows'),
      scrapingbee: remaining('scrapingbee'),
      // Apify usa su propio límite mensual y su gasto registrado: el saldo es la diferencia, y `null` si no se pudo leer
      // alguno de los dos (un hueco no es un saldo).
      apify: apifyLeft,
    },
    // Sin la segunda zona, la ruta Unlocker no está lista aunque la clave SERP exista.
    unlockerReady: Boolean(brightdataConfig?.unlockerZone),
    proxiesHealthy: false,
  };
}

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request);
  if (error) return error;
  // Gasto del mes completo (paginado), no solo las últimas 200 ejecuciones.
  const [rows, orders, caps] = await Promise.all([runsThisMonth(), routeOrders(), readCaps()]);
  const state = await stateOf(rows, caps);
  const budget: Record<string, number | null> = {};
  const spent: Record<string, number | null> = {};
  const notes = (rows ?? []).map(row => ({ note: row.note }));
  for (const provider of ['brightdata', 'jsearch', 'serpapi', 'zenrows', 'scrapingbee'] as MeteredProvider[]) {
    budget[provider] = state.budget[provider] ?? null;
    spent[provider] = rows === null ? null : (spentFromNotes(notes, provider).usd ?? 0);
    if (budget[provider] === null && state.keys.has(provider)) budget[provider] = caps[provider].usd;
  }
  const configuredProxies = Boolean((process.env.JOBSPY_PROXIES ?? '').trim());
  return     reply(auth!, {
    budget, spent,
    proxies: { configured: configuredProxies, healthy: false },
    detail: configuredProxies ? 'Proxies configurados, pero la salud se valida al lanzar JobSpy: sin una pasada no se dan por sanos.' : 'Sin proxies configurados: JobSpy no se lanza.',
    orders: orders ?? null,
    unlocker_ready: state.unlockerReady ?? false,
    ...(orders === null ? { orders_error: 'No se pudo leer el orden personalizado; se usa el orden por coste.' } : {}),
    routes: CATALOG.map(entry => ({ source: entry.code, routes: (BY_SOURCE.get(entry.code) ?? []).map(route => ({ id: route.id, provider: route.provider, label: route.label, stage: route.stage, ready: routeReadiness(route, state).ok })) })),
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { source?: unknown; order?: unknown };
  const { auth, error } = await gate(request, true);
  if (error) return error;
  if (typeof body.source !== 'string' || !Array.isArray(body.order)) return Response.json({ detail: 'Indica la fuente y el orden de sus vías.' }, { status: 422 });
  const entry = CATALOG.find(item => item.code === body.source);
  if (!entry) return Response.json({ detail: 'Esa fuente no está en el catálogo.' }, { status: 404 });
  const routes = BY_SOURCE.get(entry.code) ?? [];
  const known = new Set(routes.map(route => route.id));
  const order = body.order.filter((id): id is string => typeof id === 'string');
  if (order.length !== body.order.length || new Set(order).size !== order.length || order.some(id => !known.has(id))) {
    return Response.json({ detail: 'El orden solo puede contener vías de esa fuente, sin repetir.' }, { status: 422 });
  }
  if (!await setSourceRouteOrder(entry.code, order, auth!.admin.email)) {
    return Response.json({ detail: 'No se pudo guardar el orden. Si es la primera vez, falta aplicar la migración 20261121_source_route_order.sql.' }, { status: 503 });
  }
  return reply(auth!, { ok: true, source: entry.code, order });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: unknown; source?: unknown; route?: unknown; url?: unknown };
  const { auth, error } = await gate(request, true);
  if (error) return error;
  if (body.action !== 'test' || typeof body.source !== 'string' || typeof body.route !== 'string') return Response.json({ detail: 'Acción no válida.' }, { status: 422 });
  const entry = CATALOG.find(item => item.code === body.source);
  const routes = entry ? BY_SOURCE.get(entry.code) ?? [] : [];
  const route = routes.find(item => item.id === body.route);
  if (!entry || !route) return Response.json({ detail: 'Esa ruta no pertenece a una fuente del catálogo.' }, { status: 404 });
  const [rows, caps] = await Promise.all([runsThisMonth(), readCaps()]);
  const state = await stateOf(rows, caps);
  const readiness = routeReadiness(route, state);
  if (!readiness.ok) return Response.json({ detail: readiness.reason }, { status: 409 });

  // Motor: recoge él solo en cada pasada y forzar una desde aquí gastó antes su cuota de escrituras (octubre de 2026), así que la
  // prueba LEE su estado real para esta fuente. Sin ofertas en su catálogo no se da por buena: el panel pasa a la vía siguiente.
  if (route.provider === 'engine') {
    const base = engineBase();
    if (!base) return Response.json({ detail: 'No se puede leer el motor: falta CAREER_ENGINE_URL en el servidor.' }, { status: 409 });
    const funnel = await engineGet<{ sources?: Array<Record<string, unknown>> }>(`${base}/api/funnel`, { timeoutMs: 12_000 });
    if (!funnel.ok) return Response.json({ detail: `El motor no responde: ${ENGINE_STATUS_TEXT[funnel.reason]}` }, { status: 502 });
    const found = Array.isArray(funnel.data?.sources) ? funnel.data!.sources!.find(item => item.code === entry.code) : undefined;
    const catalog = Number(found?.catalogo ?? 0) || 0;
    const fetched = typeof found?.revisadas === 'number' ? found.revisadas : null;
    const runStatus = typeof found?.run_status === 'string' ? found.run_status : null;
    if (!found || (catalog === 0 && !fetched)) {
      const why = found ? `su última recogida quedó «${runStatus ?? 'sin estado'}»${found.fuente ? ` (${String(found.fuente).slice(0, 120)})` : ''}` : 'no aparece en su última recogida';
      return Response.json({ detail: `El motor no tiene ofertas de ${entry.name}: ${why}.` }, { status: 409 });
    }
    return reply(auth!, {
      ok: true, accepted: 0, engine: { catalog, fetched, run_status: runStatus },
      note: `Motor: ${catalog.toLocaleString('es')} oferta(s) de ${entry.name} en su catálogo; última recogida: ${fetched ?? '—'} revisada(s)${runStatus ? ` (${runStatus})` : ''}. La recoge él solo en cada pasada; esta prueba lee su estado real y no lanza otra para no gastar su cuota de escrituras.`,
    });
  }

  // Apify: lanza la búsqueda de prueba del portal (10 ofertas como máximo, tope de gasto de la prueba). Los resultados llegan
  // después y se recogen solos; la respuesta lo dice, no finge que ya hay ofertas.
  if (route.provider === 'apify') {
    const portal = PORTALS.find(item => item.source === `apify-${entry.code}` || item.id === entry.code);
    if (!portal) return Response.json({ detail: 'Esta fuente no tiene un portal de Apify auditado.' }, { status: 422 });
    const result = await searchPortal(portal, { by: auth!.admin.email, publicBase: publicBaseUrl(request), test: true });
    if (!result.ok) return Response.json({ detail: result.error }, { status: result.busy ? 409 : 502 });
    return reply(auth!, { ok: true, accepted: 0, async: true, note: `Búsqueda de prueba lanzada en Apify con «${result.recipe}»${result.fallback ? ' (el primer buscador falló y entró un repuesto)' : ''}: 10 ofertas como máximo y tope de 0,50 US$. Los resultados llegan en unos minutos y se guardan solos; el coste real aparece al terminar.` });
  }

  // Gratis: no hay llamada que probar; se declara en vez de gastar una petición inútil.
  if (route.cost === 'free' && route.provider !== 'jobspy') {
    return reply(auth!, { ok: true, accepted: 0, note: `${entry.name}: la recoge el motor sin clave. No se hizo ninguna llamada desde el panel.` });
  }

  if (route.provider === 'official') {
    const provider = route.requiresKey as ApiProvider;
    const outcomes = await collectAll('panel-ruta', provider, Date.now() + 40_000);
    const outcome = outcomes[0];
    if (!outcome) return Response.json({ detail: 'La API oficial no devolvió ningún resultado.' }, { status: 502 });
    return reply(auth!, { ok: outcome.ok, accepted: outcome.accepted ?? 0, note: outcome.ok ? `${entry.name}: ${outcome.accepted ?? 0} guardada(s) con la API oficial.` : (outcome.error ?? 'La API oficial falló.') }, outcome.ok ? 200 : 502);
  }

  if (route.provider === 'brightdata') {
    const secret = await getSecret('brightdata');
    const resolved = secret ? await resolveBrightDataConfig(secret, { useCache: false }) : null; // una petición de pago no se fía de una zona en caché
    const config = resolved?.config ?? null;
    if (!config) return Response.json({ detail: 'La clave de Bright Data no tiene un formato utilizable: pega la API key o API key:zona SERP.' }, { status: 409 });
    if (!config.serpZone) {
      // Se declara la causa real (sin zona SERP o cuenta ilegible) en vez de culpar a la clave.
      return Response.json({ detail: resolved?.error
        ? `La clave es válida, pero no se pudieron leer las zonas de Bright Data (${resolved.error}). Guarda la clave como API key:zona SERP.`
        : 'La clave es válida, pero la cuenta no tiene una zona SERP activa en Bright Data.' }, { status: 409 });
    }
    // `canSpend` recibe el GASTO, no el saldo: pasarle el restante hacía que un tope de 5 USD pareciera agotado.
    // Reserva los DOS intentos: un reintento no puede dejar el gasto por encima del tope.
    const check = canSpend('brightdata', spentOf(rows, 'brightdata'), process.env, 2, caps.brightdata.usd);
    if (!check.ok) return Response.json({ detail: check.reason }, { status: 409 });
    const host = hostOf(entry.website);
    const query = entry.code === 'google' || !host ? 'closer de ventas España' : `site:${host} closer de ventas`;
    const source = brightDataSource(entry.code);
    const brightNote = (requests: number, costUsd: number, detail: string) => spendNote({
      route: `${route.stage + 1}/${routes.length}`, provider: 'brightdata', requests, costUsd, detail,
    });
    let result: Awaited<ReturnType<typeof serpJobs>>;
    try {
      result = await serpJobs(config, { query, gl: 'es', hl: 'es', timeoutMs: 40_000, maxAttempts: 1 });
    } catch (err) {
      // Un fallo de red pudo facturarse sin respuesta: se anota el peor caso antes de devolver el error.
      if (err instanceof BrightDataError && billed(err.status) && err.attempts > 0) {
        await recordSpend(source, 'brightdata-serp', brightNote(err.attempts, err.attempts * PROVIDER_METERS.brightdata.usdPerRequest, `${entry.code} · fallo tras ${err.attempts} intento(s)`));
      }
      return Response.json({ detail: err instanceof Error ? err.message : 'Bright Data no respondió.' }, { status: err instanceof BrightDataError && err.status ? err.status : 502 });
    }
    let saved: Awaited<ReturnType<typeof ingest>>;
    try {
      saved = await ingest(source, 'brightdata-serp', result.candidates, brightNote(result.requests, result.costUsd, `${entry.code} · ${result.rawItems} en bruto`));
    } catch (err) {
      // La llamada ya se pagó: si la ingesta falla, la nota se escribe por separado para no perder el gasto.
      await recordSpend(source, 'brightdata-serp', brightNote(result.requests, result.costUsd, `${entry.code} · ingesta fallida`));
      throw err;
    }
    return reply(auth!, { ok: true, accepted: saved.accepted, received: result.candidates.length, cost_usd: result.costUsd, note: `Bright Data devolvió ${result.rawItems} resultados; ${saved.accepted} guardada(s).` });
  }

  if (route.provider === 'jsearch') {
    const secret = await getSecret('jsearch');
    if (!secret) return Response.json({ detail: 'Sin clave de JSearch.' }, { status: 409 });
    // Mismo tope efectivo que las demás: la tabla manda y el entorno es el respaldo.
    const check = canSpend('jsearch', spentOf(rows, 'jsearch'), process.env, 1, caps.jsearch.usd);
    if (!check.ok) return Response.json({ detail: check.reason }, { status: 409 });
    const host = hostOf(entry.website);
    const query = entry.code === 'google' || !host ? 'closer de ventas España' : `site:${host} closer de ventas`;
    // Una petición = una página de hasta 10 ofertas. Se reserva exactamente una: esta vía no pagina.
    const jsearchNote = (requests: number, costUsd: number, detail: string) => spendNote({
      route: `${route.stage + 1}/${routes.length}`, provider: 'jsearch', requests, costUsd, detail,
    });
    let result: Awaited<ReturnType<typeof jsearchJobs>>;
    try {
      result = await jsearchJobs(secret, { query, country: 'es', language: 'es', timeoutMs: 20_000 });
    } catch (err) {
      // Un fallo sin respuesta (red, timeout) se anota como peor caso: la petición pudo salir y cobrarse.
      // Un 2xx con estado de error ya se pagó; un 401/403/429/5xx, no.
      if (err instanceof JSearchError && billed(err.status)) {
        const reason = err.status === null ? 'fallo de red · se anota el peor caso' : 'respuesta con estado de error';
        await recordSpend('google-jobs', 'jsearch-ruta', jsearchNote(1, PROVIDER_METERS.jsearch.usdPerRequest, `${entry.code} · ${reason}`));
      }
      return Response.json({ detail: err instanceof Error ? err.message : 'JSearch no respondió.' }, { status: 502 });
    }
    let saved: Awaited<ReturnType<typeof ingest>>;
    try {
      saved = await ingest('google-jobs', 'jsearch-ruta', result.candidates, jsearchNote(result.requests, result.costUsd, `${entry.code} · ${result.rawItems} en bruto`));
    } catch (err) {
      // La petición ya se pagó: si la ingesta falla, la nota se escribe por separado para no perder el gasto.
      await recordSpend('google-jobs', 'jsearch-ruta', jsearchNote(result.requests, result.costUsd, `${entry.code} · ingesta fallida`));
      throw err;
    }
    return reply(auth!, { ok: true, accepted: saved.accepted, received: result.candidates.length, cost_usd: result.costUsd, note: `JSearch devolvió ${result.rawItems} resultados; ${saved.accepted} guardada(s).` });
  }

  if (route.provider === 'serpapi') {
    const secret = await getSecret('serpapi');
    if (!secret) return Response.json({ detail: 'Sin clave de SerpApi.' }, { status: 409 });
    const check = canSpend('serpapi', spentOf(rows, 'serpapi'), process.env, 1, caps.serpapi.usd);
    if (!check.ok) return Response.json({ detail: check.reason }, { status: 409 });
    const host = hostOf(entry.website);
    const query = entry.code === 'google' || !host ? 'closer de ventas España' : `site:${host} closer de ventas`;
    const url = `${process.env.SERPAPI_API_BASE ?? 'https://serpapi.com'}/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&gl=es&hl=es&api_key=${encodeURIComponent(secret)}`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return Response.json({ detail: `SerpApi respondió HTTP ${response.status}.` }, { status: 502 });
    const payload = await response.json().catch(() => ({})) as { jobs_results?: unknown[]; error?: string };
    if (payload.error) return Response.json({ detail: `SerpApi: ${payload.error}` }, { status: 502 });
    const candidates = (payload.jobs_results ?? []).map(serpCandidate).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    const saved = await ingest('google-jobs', 'serpapi-ruta', candidates, spendNote({ route: `${route.stage + 1}/${routes.length}`, provider: 'serpapi', requests: 1, costUsd: 0.025, detail: entry.code }));
    return reply(auth!, { ok: true, accepted: saved.accepted, received: candidates.length, cost_usd: 0.025, note: `SerpApi devolvió ${candidates.length}; ${saved.accepted} guardada(s).` });
  }

  if (route.provider === 'unlocker') {
    const url = typeof body.url === 'string' ? body.url : entry.website;
    if (!url) return Response.json({ detail: 'Falta una URL pública con JSON-LD o RSS.' }, { status: 422 });
    const provider = state.keys.has('zenrows') ? 'zenrows' : state.keys.has('scrapingbee') ? 'scrapingbee' : 'brightdata';
    const secret = await getSecret(provider);
    if (!secret) return Response.json({ detail: `Sin clave de ${provider}.` }, { status: 409 });
    // Igual que en SERP: se reservan los dos intentos del cliente de HTML.
    const check = canSpend(provider, spentOf(rows, provider), process.env, 2, caps[provider].usd);
    if (!check.ok) return Response.json({ detail: check.reason }, { status: 409 });
    const source = provider === 'brightdata' ? brightDataSource(entry.code) : `${provider}-${entry.code}`;
    const note = (requests: number, costUsd: number) => spendNote({ route: `${route.stage + 1}/${routes.length}`, provider, requests, costUsd, detail: entry.code });
    try {
      const page = await fetchHtml(provider, secret, url, { timeoutMs: 25_000 });
      const jobs = extractJobPostings(page.html, url);
      if (!jobs.length) {
        // La petición se pagó aunque no haya JobPosting: se anota antes de devolver el 422.
        const recorded = await recordSpend(source, `${provider}-unlocker`, note(page.requests, page.costUsd));
        return reply(auth!, { ok: false, accepted: 0, cost_usd: page.costUsd, note: recorded
          ? 'La página no publica JobPosting ni RSS: no se inventa ninguna oferta.'
          : 'La página no publica JobPosting ni RSS y el gasto no se pudo anotar; revisa el historial antes de reintentar.' }, 422);
      }
      let saved: Awaited<ReturnType<typeof ingest>>;
      try {
        saved = await ingest(source, `${provider}-unlocker`, jobs, note(page.requests, page.costUsd));
      } catch (err) {
        // Igual que en SERP: la página ya se pagó aunque la ingesta falle.
        await recordSpend(source, `${provider}-unlocker`, note(page.requests, page.costUsd));
        throw err;
      }
      return reply(auth!, { ok: true, accepted: saved.accepted, received: jobs.length, cost_usd: page.costUsd, note: `${jobs.length} detectada(s) en el HTML; ${saved.accepted} guardada(s).` });
    } catch (err) {
      if (err instanceof BrightDataError && billed(err.status) && err.attempts > 0) {
        await recordSpend(source, `${provider}-unlocker`, note(err.attempts, err.attempts * PROVIDER_METERS[provider].usdPerRequest));
      }
      // URL no HTTPS o proveedor caído: se declara con su estado, nunca un 500 genérico.
      const status = err instanceof BrightDataError && err.status ? err.status : 502;
      return Response.json({ detail: err instanceof Error ? err.message : 'No se pudo leer la página.' }, { status });
    }
  }

  return Response.json({ detail: 'Esta vía se lanza fuera del panel (Apify o GitHub Actions); usa su pestaña para ejecutarla.' }, { status: 422 });
}
