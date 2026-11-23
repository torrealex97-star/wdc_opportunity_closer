import { ingest, pausedSourcesStrict, recordSpend, type Candidate } from './external';
import { loadMeter, type Meter } from './providerCaps';
import { spendNote } from './providerBudget';
import { getSecret } from './integrations';
import { ORG } from './external';
import { callTimeout, timeLeft, MIN_STEP_MS } from './cronBudget';
import { serviceRest } from './supabaseAuth';
import { buildQuery } from './searchBank';
import { FALLBACK_PORTALS, cleanTitle, organicToCandidate, type FallbackPortal } from './jobPortals';
export { FALLBACK_PORTALS, cleanTitle, organicToCandidate, type FallbackPortal };

// Respaldo de cobertura: si un portal no tiene API oficial conectada (o su clave falla), se busca en
// Google con SerpApi acotado a ese portal (`site:`). Google ya rastrea InfoJobs, Indeed, Computrabajo,
// Bumerán y OCCMundial, así que es la vía más barata para que no falte inventario en los mercados
// donde el SOP pide buscar. Cada búsqueda cuesta 0,025 USD y se declara: nunca se gasta a ciegas.
//
// Lo que este módulo NO hace: inventar datos. De una ficha de Google solo se toman título, enlace y
// resumen; empresa, ubicación y salario quedan como «no indicado» salvo que el resumen los mencione
// con una cifra literal (el salario se rescata con la misma regla que el resto de fuentes).
export const SEARCH_USD = 0.025;
export const DEFAULT_MAX = 4;
export const DEFAULT_TARGET = 60;



export const maxSearches = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = Number(env.SERPAPI_FALLBACK_MAX_SEARCHES ?? DEFAULT_MAX);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), FALLBACK_PORTALS.length) : DEFAULT_MAX;
};
export const targetPerDay = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = Number(env.DAILY_TARGET_OFFERS ?? DEFAULT_TARGET);
  return Number.isFinite(raw) ? Math.max(Math.floor(raw), 0) : DEFAULT_TARGET;
};

/** Ofertas aceptadas hoy (UTC) por cualquier fuente: sirve para saber si hace falta respaldo. */
export async function acceptedToday(now = new Date()): Promise<number | null> {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const response = await serviceRest(`external_ingest_runs?org_id=eq.${ORG}&created_at=gte.${encodeURIComponent(start.toISOString())}&select=accepted`).catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows.reduce((a: number, r: { accepted?: number }) => a + (Number(r.accepted) || 0), 0) : null;
}

export type PlanInput = { missing: string[]; paused: Set<string> | null; recent: Set<string>; max?: number };
/**
 * Qué búsquedas de respaldo tocar, en este orden: 1) portales cuya API oficial no está (sin clave o
 * falló), 2) portales sin ninguna otra vía (LatAm y agregadores), 3) el resto, solo si su fuente no
 * trajo nada en 24 h. Un portal que ya trajo ofertas ayer no se vuelve a pagar hoy: el respaldo cubre
 * huecos, no duplica inventario. Sin saber qué fuentes están pausadas no se planifica nada.
 */
export function planFallback({ missing, paused, recent, max = DEFAULT_MAX }: PlanInput): FallbackPortal[] {
  if (!paused) return [];
  const missingSet = new Set(missing.map(m => m.toLowerCase()));
  const coversMissingApi = (p: FallbackPortal) => Boolean(p.replaces && missingSet.has(p.replaces));
  const available = FALLBACK_PORTALS.filter(p => !paused.has(p.source) && (coversMissingApi(p) || !p.replaces || !recent.has(p.replaces)));
  const first = available.filter(coversMissingApi);
  const second = available.filter(p => !coversMissingApi(p) && !p.replaces);
  const third = available.filter(p => !coversMissingApi(p) && Boolean(p.replaces));
  return [...first, ...second, ...third].slice(0, Math.min(max, available.length));
}

type Fetcher = (portal: FallbackPortal, timeoutMs: number) => Promise<Candidate[]>;
export function serpapiSiteFetcher(secret: string): Fetcher {
  return async (portal, timeoutMs) => {
    const base = process.env.SERPAPI_API_BASE ?? 'https://serpapi.com';
    const url = `${base}/search.json?engine=google&q=${encodeURIComponent(buildQuery('google', portal.query, { site: portal.site }))}&gl=${portal.gl}&hl=es&num=20&api_key=${encodeURIComponent(secret)}`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as Record<string, unknown>;
    const error = typeof data.error === 'string' ? data.error : '';
    if (error) {
      if (/returned any results|hasn't returned|didn't return/i.test(error)) return [];
      throw new Error(`SerpApi: ${error}`);
    }
    const rows = Array.isArray(data.organic_results) ? data.organic_results : [];
    return rows.map(r => organicToCandidate(r, portal)).filter((c): c is Candidate => c !== null);
  };
}

export type FallbackOutcome = { source: string; portal: string; ok: boolean; accepted?: number; received?: number; searches: number; cost_usd: number; error?: string; truncated?: boolean; skipped?: string };
export type FallbackSummary = { ok: boolean; need: number | null; accepted_before: number | null; searches: number; cost_usd: number; outcomes: FallbackOutcome[]; truncated?: boolean };

type Deps = { deadline?: number; max?: number; fetcher?: Fetcher; need?: number | null; missing?: string[]; meter?: Meter };

/**
 * Ejecuta el plan de respaldo. Se detiene cuando ya hay suficientes ofertas del día, cuando el reloj
 * del cron se acaba o cuando se agota el número de búsquedas permitidas; todo corte se declara.
 */
export async function collectFallback(via: string, deps: Deps = {}): Promise<FallbackSummary> {
  const max = deps.max ?? maxSearches();
  const out: FallbackSummary = { ok: false, need: deps.need ?? null, accepted_before: null, searches: 0, cost_usd: 0, outcomes: [] };
  if (max === 0) return { ...out, outcomes: [{ source: 'serpapi', portal: '—', ok: false, searches: 0, cost_usd: 0, skipped: 'respaldo desactivado (SERPAPI_FALLBACK_MAX_SEARCHES=0)' }] };
  const paused = await pausedSourcesStrict();
  if (!paused) return { ...out, outcomes: [{ source: 'serpapi', portal: '—', ok: false, searches: 0, cost_usd: 0, skipped: 'no se pudo comprobar qué fuentes están pausadas' }] };

  // Volumen: si el día ya cumplió el objetivo, no se gasta en respaldo.
  const before = deps.need === undefined ? await acceptedToday() : null;
  const need = deps.need === undefined ? (before === null ? null : targetPerDay() - before) : deps.need;
  out.need = need; out.accepted_before = before;
  // Sin saber cuántas ofertas lleva el día no se puede decidir si hace falta respaldo: no se gasta y se dice por qué.
  if (need === null) return { ...out, truncated: true, outcomes: [{ source: 'serpapi', portal: '—', ok: false, searches: 0, cost_usd: 0, error: 'No se pudo leer el objetivo diario de ofertas: no se gasta en respaldo.' }] };
  if (need <= 0) return { ...out, ok: true, outcomes: [{ source: 'serpapi', portal: '—', ok: true, searches: 0, cost_usd: 0, skipped: `objetivo diario cumplido (${targetPerDay()})` }] };

  const secret = await getSecret('serpapi');
  if (!secret) return { ...out, outcomes: [{ source: 'serpapi', portal: '—', ok: false, searches: 0, cost_usd: 0, error: 'Sin clave guardada de SerpApi: el respaldo no puede buscar.' }] };

  const recent = await recentSources().catch(() => new Set<string>());
  const plan = planFallback({ missing: deps.missing ?? [], paused, recent, max });
  if (!plan.length) return { ...out, ok: true, outcomes: [{ source: 'serpapi', portal: '—', ok: true, searches: 0, cost_usd: 0, skipped: 'ningún portal necesita respaldo' }] };

  const fetchFor = deps.fetcher ?? serpapiSiteFetcher(secret);
  // Tope mensual en USD: cada búsqueda se comprueba contra el gasto YA anotado (sin gasto legible no se lanza).
  const meter = deps.meter ?? await loadMeter();
  const errors: string[] = [];
  let unrecorded = false;
  for (const portal of plan) {
    if (timeLeft(deps.deadline) < MIN_STEP_MS) { out.truncated = true; break; }
    if (paused.has(portal.source)) { out.outcomes.push({ source: portal.source, portal: portal.name, ok: false, searches: 0, cost_usd: 0, skipped: 'fuente pausada' }); continue; }
    if (out.searches > 0 && need - out.searches * 8 <= 0) break; // cada búsqueda aporta ~8 ofertas: deja de gastar si ya sobra
    const gate = meter.check('serpapi');
    if (!gate.ok) {
      out.outcomes.push({ source: portal.source, portal: portal.name, ok: false, searches: 0, cost_usd: 0, skipped: `tope mensual de SerpApi: ${gate.reason ?? 'agotado'}` });
      break; // el tope es del proveedor, no del portal: el resto tampoco cabe
    }
    meter.charge('serpapi', SEARCH_USD);
    out.searches++;
    out.cost_usd = Number((out.searches * SEARCH_USD).toFixed(3));
    const note = spendNote({ route: 'respaldo', provider: 'serpapi', requests: 1, costUsd: SEARCH_USD, detail: portal.source });
    let candidates: Candidate[];
    try {
      candidates = await fetchFor(portal, callTimeout(12_000, deps.deadline));
    } catch (err) {
      // Una petición que SerpApi rechaza (HTTP de error, clave mala) no se cobra: no se anota y se devuelve la
      // reserva de esta pasada Y los contadores, para que resultado, medidor y panel digan lo mismo.
      meter.charge('serpapi', -SEARCH_USD);
      out.searches--;
      out.cost_usd = Number((out.searches * SEARCH_USD).toFixed(3));
      errors.push(`${portal.name}: ${(err as Error).message}`);
      out.outcomes.push({ source: portal.source, portal: portal.name, ok: false, searches: 0, cost_usd: 0, error: (err as Error).message });
      continue;
    }
    // SerpApi respondió: la búsqueda se cobró. El gasto se anota AHORA, aparte de guardar las ofertas, para que un
    // fallo al guardar no deje un gasto real sin anotar (y por tanto fuera del tope).
    if (!await recordSpend(portal.source, via, note)) unrecorded = true;
    if (!candidates.length) {
      out.outcomes.push({ source: portal.source, portal: portal.name, ok: true, received: 0, accepted: 0, searches: 1, cost_usd: SEARCH_USD });
      continue;
    }
    try {
      const r = await ingest(portal.source, via, candidates);
      out.outcomes.push({ source: portal.source, portal: portal.name, ok: true, received: r.received, accepted: r.accepted, searches: 1, cost_usd: SEARCH_USD });
    } catch (err) {
      errors.push(`${portal.name}: ${(err as Error).message}`);
      out.outcomes.push({ source: portal.source, portal: portal.name, ok: false, searches: 1, cost_usd: SEARCH_USD, error: (err as Error).message });
    }
  }
  if (unrecorded) out.outcomes.push({ source: 'serpapi', portal: '—', ok: false, searches: 0, cost_usd: 0, error: 'Un gasto de SerpApi no se pudo anotar: el marcador de inversión lo verá de menos.' });
  return { ...out, ok: out.outcomes.some(o => o.ok), cost_usd: Number((out.searches * SEARCH_USD).toFixed(3)), ...(out.truncated ? { truncated: true } : {}), ...(errors.length ? { outcomes: out.outcomes } : {}) };
}

/** Fuentes que ya trajeron ofertas aceptadas en las últimas 24 h (para no duplicar su respaldo). */
async function recentSources(now = Date.now()): Promise<Set<string>> {
  const since = encodeURIComponent(new Date(now - 864e5).toISOString());
  const response = await serviceRest(`external_ingest_runs?org_id=eq.${ORG}&created_at=gte.${since}&select=source,accepted`);
  const rows = response.ok ? await response.json().catch(() => []) : [];
  return new Set((Array.isArray(rows) ? rows : []).filter((r: { accepted?: number }) => Number(r.accepted) > 0).map((r: { source: string }) => r.source));
}
