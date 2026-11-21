import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { collectAll, type ApiProvider } from '../../../../lib/collectors';
import { getSecret, listConnections } from '../../../../lib/integrations';
import { ingest, routeOrders, runsThisMonth, setSourceRouteOrder } from '../../../../lib/external';
import { toCandidate as serpCandidate } from '../../../../lib/googleJobs';
import { extractJobPostings } from '../../../../lib/jobPosting';
import { canSpend, capUsd, spendNote, spentFromNotes, type MeteredProvider } from '../../../../lib/providerBudget';
import { BrightDataError, brightDataSource, parseBrightDataSecret, serpJobs } from '../../../../lib/providers/brightdata';
import { fetchHtml } from '../../../../lib/providers/unlocker';
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
async function stateOf(rows: RunNote[] | null): Promise<RouteState> {
  const notes = (rows ?? []).map(row => ({ note: row.note }));
  const spent = (provider: MeteredProvider) => rows === null ? null : (spentFromNotes(notes, provider).usd ?? 0);
  const remaining = (provider: MeteredProvider) => {
    const used = spent(provider);
    return used === null ? null : Math.max(0, capUsd(provider) - used);
  };
  const [connections, brightdataSecret] = await Promise.all([listConnections(), getSecret('brightdata')]);
  const keys = new Set((connections ?? []).map(row => row.provider));
  const brightdataConfig = brightdataSecret ? parseBrightDataSecret(brightdataSecret) : null;
  return {
    keys,
    paused: false,
    budget: {
      brightdata: remaining('brightdata'),
      serpapi: remaining('serpapi'),
      zenrows: remaining('zenrows'),
      scrapingbee: remaining('scrapingbee'),
      // Apify usa su tabla de presupuesto, no este entorno: aquí no se inventa un saldo.
      apify: null,
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
  const [rows, orders] = await Promise.all([runsThisMonth(), routeOrders()]);
  const state = await stateOf(rows);
  const budget: Record<string, number | null> = {};
  const spent: Record<string, number | null> = {};
  const notes = (rows ?? []).map(row => ({ note: row.note }));
  for (const provider of ['brightdata', 'serpapi', 'zenrows', 'scrapingbee'] as MeteredProvider[]) {
    budget[provider] = state.budget[provider] ?? null;
    spent[provider] = rows === null ? null : (spentFromNotes(notes, provider).usd ?? 0);
    if (budget[provider] === null && state.keys.has(provider)) budget[provider] = capUsd(provider);
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
  const rows = await runsThisMonth();
  const state = await stateOf(rows);
  const readiness = routeReadiness(route, state);
  if (!readiness.ok) return Response.json({ detail: readiness.reason }, { status: 409 });

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
    const config = secret ? parseBrightDataSecret(secret) : null;
    if (!config) return Response.json({ detail: 'La clave de Bright Data no tiene el formato API key:zona SERP.' }, { status: 409 });
    // `canSpend` recibe el GASTO, no el saldo: pasarle el restante hacía que un tope de 5 USD pareciera agotado.
    const check = canSpend('brightdata', spentOf(rows, 'brightdata'));
    if (!check.ok) return Response.json({ detail: check.reason }, { status: 409 });
    const host = hostOf(entry.website);
    const query = entry.code === 'google' || !host ? 'closer de ventas España' : `site:${host} closer de ventas`;
    const result = await serpJobs(config, { query, gl: 'es', hl: 'es', timeoutMs: 20_000 });
    const source = brightDataSource(entry.code);
    const saved = await ingest(source, 'brightdata-serp', result.candidates, spendNote({ route: `${route.stage + 1}/${routes.length}`, provider: 'brightdata', requests: result.requests, costUsd: result.costUsd, detail: `${entry.code} · ${result.rawItems} en bruto` }));
    return reply(auth!, { ok: true, accepted: saved.accepted, received: result.candidates.length, cost_usd: result.costUsd, note: `Bright Data devolvió ${result.rawItems} resultados; ${saved.accepted} guardada(s).` });
  }

  if (route.provider === 'serpapi') {
    const secret = await getSecret('serpapi');
    if (!secret) return Response.json({ detail: 'Sin clave de SerpApi.' }, { status: 409 });
    const check = canSpend('serpapi', spentOf(rows, 'serpapi'));
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
    const check = canSpend(provider, spentOf(rows, provider));
    if (!check.ok) return Response.json({ detail: check.reason }, { status: 409 });
    try {
      const page = await fetchHtml(provider, secret, url, { timeoutMs: 25_000 });
      const jobs = extractJobPostings(page.html, url);
      if (!jobs.length) return reply(auth!, { ok: false, accepted: 0, cost_usd: page.costUsd, note: 'La página no publica JobPosting ni RSS: no se inventa ninguna oferta.' }, 422);
      const source = provider === 'brightdata' ? brightDataSource(entry.code) : `${provider}-${entry.code}`;
      const saved = await ingest(source, `${provider}-unlocker`, jobs, spendNote({ route: `${route.stage + 1}/${routes.length}`, provider, requests: page.requests, costUsd: page.costUsd, detail: entry.code }));
      return reply(auth!, { ok: true, accepted: saved.accepted, received: jobs.length, cost_usd: page.costUsd, note: `${jobs.length} detectada(s) en el HTML; ${saved.accepted} guardada(s).` });
    } catch (err) {
      // URL no HTTPS o proveedor caído: se declara con su estado, nunca un 500 genérico.
      const status = err instanceof BrightDataError && err.status ? err.status : 502;
      return Response.json({ detail: err instanceof Error ? err.message : 'No se pudo leer la página.' }, { status });
    }
  }

  return Response.json({ detail: 'Esta vía se lanza fuera del panel (Apify o GitHub Actions); usa su pestaña para ejecutarla.' }, { status: 422 });
}
