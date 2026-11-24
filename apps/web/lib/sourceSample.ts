import { countExact, ORG, statsBySource } from './external';
import { pagedRest, serviceRest } from './supabaseAuth';
import { fmtInt } from './formatInt';
import { recordedCosts, type ActorLite, type NoteLite, type RunLite } from './sourceCost';
import { listConnections } from './integrations';
import { classifySource, type ApifyActorLite, type ApifyRunLite, type SourceHealth } from './sourceHealth';
import { planCascade, routesForCatalog, type RouteState } from './sourceRoutes';
import { engineBase, engineGet } from './engineHealth';
import { engineBySource, engineHealth, type EngineFunnel, type EngineView } from './engineSources';

// Muestra por fuente: cuántas ofertas ÚNICAS (sin repetir) ha recogido cada fuente y cuántas se aprobaron, para saber
// cuándo hay datos suficientes para juzgarla. Decisión del dueño (2026-11-22): ninguna fuente de pago se recorta por
// rendimiento hasta tener al menos 1.000 ofertas recogidas con las búsquedas de closer bien hechas. Mientras tanto la
// lectura es «sin conclusión», no «rinde mal». Aquí no se pausa ni se recorta nada: solo se mide y se dice.

export const SAMPLE_TARGET = 1000;
/**
 * Desde cuándo cuenta la muestra de cada fuente: la fecha en que se corrigió su búsqueda (paquete A1 del plan). Sin
 * entrada, cuenta todo lo recogido. Se actualiza en la misma PR que cambia la búsqueda, para no mezclar la muestra
 * de la búsqueda antigua con la de la nueva.
 */
export const SAMPLE_SINCE: Record<string, string | null> = {};

export type SampleInput = { source: string; seen: number | null; approved: number | null; cost_usd: number | null };
export type SampleRow = SampleInput & {
  state: 'sin_dato' | 'sin_conclusion' | 'medida';
  missing: number | null;
  approved_pct: number | null;
  approved_per_usd: number | null;
  since: string | null;
  note: string;
};

/** El coste registrado es acumulado de siempre: con fecha de corte no se mezcla con recogidas y aprobadas desde esa fecha (hueco, no un cociente de ventanas distintas). */
export const windowedCost = (since: string | null, allTimeUsd: number | null): number | null => since ? null : allTimeUsd;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Pura: un hueco es «—» con su causa, nunca un cero; con menos de `target` no hay conclusión. */
export function sampleRow(input: SampleInput, since: string | null = null, target = SAMPLE_TARGET): SampleRow {
  const { seen, approved, cost_usd } = input;
  const base = { ...input, since };
  if (seen === null) return { ...base, state: 'sin_dato', missing: null, approved_pct: null, approved_per_usd: null, note: 'No se pudo contar lo recogido: no es cero.' };
  const approved_pct = approved === null || seen === 0 ? null : round((approved / seen) * 100, 1);
  const approved_per_usd = approved === null || cost_usd === null || cost_usd <= 0 ? null : round(approved / cost_usd, 2);
  if (seen < target) {
    return { ...base, state: 'sin_conclusion', missing: target - seen, approved_pct, approved_per_usd, note: `Faltan ${fmtInt(target - seen)} para poder concluir; hasta entonces no se recorta.` };
  }
  return { ...base, state: 'medida', missing: 0, approved_pct, approved_per_usd, note: 'Muestra suficiente: ya se puede comparar con otras fuentes.' };
}

export type HealthRow = SampleRow & { health: SourceHealth | null; drafts: number | null; engine: EngineView | null };
export type SamplePayload = { target: number; rows: HealthRow[]; basis: string; cost_note: string | null; health_note: string | null; engine_note: string | null; engine_run: { day: string | null; status: string | null } | null };

type CatalogEntry = { code: string; name: string; website?: string | null; requires?: string | null; acquisition_method?: string | null; category?: string | null };
// Carga perezosa: las pruebas puras importan este módulo y el JSON exige un atributo de importación que Node no admite aquí.
const loadCatalog = async () => {
  const catalog = (await import('./sourceCatalog.json')).default as CatalogEntry[];
  return { catalog, routes: routesForCatalog(catalog) };
};
/** Ventana de ejecuciones de Apify que cuenta para decir «mal conectada». */
const RUN_WINDOW_DAYS = 8;

/** Solo importa si hay CLAVE: el saldo no es un problema de conexión, así que se da por suficiente. */
const keyState = (keys: Set<string>): RouteState => ({
  keys, paused: false, proxiesHealthy: false, unlockerReady: true,
  budget: { brightdata: 1e9, jsearch: 1e9, serpapi: 1e9, zenrows: 1e9, scrapingbee: 1e9, apify: 1e9 },
});

/** Lee la base: recogidas y aprobadas por fuente (desde su fecha de corte) y el coste registrado. `null` = no se pudo leer la lista de fuentes. */
export async function readSamples(since: Record<string, string | null> = SAMPLE_SINCE): Promise<SamplePayload | null> {
  const stats = await statsBySource().catch(() => null);
  if (!stats) return null;
  // Las fuentes gratuitas del motor viven en su propia base: su estado sale del informe del motor, no de contar `external_offers`.
  const engineUrl = engineBase();
  const engineRead = engineUrl ? await engineGet<EngineFunnel>(`${engineUrl}/api/funnel`) : null;
  const engineFunnel = engineRead?.ok ? engineRead.data : null;
  const engineViews = engineBySource(engineFunnel);
  const { catalog: CATALOG, routes: ROUTES } = await loadCatalog();
  const windowStart = new Date(Date.now() - RUN_WINDOW_DAYS * 86400_000).toISOString();
  const [actorsResponse, runs, notes, connections, recentRunsResponse] = await Promise.all([
    serviceRest(`apify_actors?org_id=eq.${ORG}&select=id,source,status,schedule_daily`).catch(() => null),
    pagedRest<RunLite>(`apify_runs?org_id=eq.${ORG}&select=actor_id,cost_usd,status`, 'id.asc').catch(() => null),
    pagedRest<NoteLite>(`external_ingest_runs?org_id=eq.${ORG}&select=source,note&note=like.${encodeURIComponent('*respaldo SerpApi*')}`, 'id.asc').catch(() => null),
    listConnections().catch(() => null),
    serviceRest(`apify_runs?org_id=eq.${ORG}&started_at=gte.${encodeURIComponent(windowStart)}&select=actor_id,status,harvested,error,started_at&order=started_at.desc&limit=1000`).catch(() => null),
  ]);
  const actors = actorsResponse?.ok ? await actorsResponse.json().catch(() => null) : null;
  const recentRuns = recentRunsResponse?.ok ? await recentRunsResponse.json().catch(() => null) as Array<{ actor_id: string; status: string; harvested: number | null; error: string | null; started_at: string }> | null : null;
  const state = connections ? keyState(new Set(connections.map(row => row.provider))) : null;
  
  // Un tope de paginación alcanzado deja el coste incompleto: se declara como hueco en vez de sumar de menos.
  const cost = runs?.truncated || notes?.truncated || !Array.isArray(actors) || !runs || !notes ? null : recordedCosts(actors as ActorLite[], runs.rows, notes.rows);
  // Todas las fuentes del catálogo, también las que nunca han recogido: ahí es donde se esconde una mala conexión.
  const names = [...new Set([...stats.map(stat => stat.source), ...CATALOG.map(entry => entry.code), ...engineViews.keys()])];
  const rows: HealthRow[] = await Promise.all(names.map(async source => {
    const from = since[source] ?? null;
    const filters = [`org_id=eq.${ORG}`, `source=eq.${encodeURIComponent(source)}`, ...(from ? [`first_seen_at=gte.${encodeURIComponent(from)}`] : [])];
    const [seen, approved] = await Promise.all([countExact(filters), countExact([...filters, 'editorial_status=in.(approved,published)'])]);
    const drafts = seen === null || seen === 0 ? (seen === 0 ? 0 : null) : await countExact([...filters, 'editorial_status=eq.draft']);
    const usd = cost?.usdBySource.get(source);
    // Fuente del motor: «recogidas» = su catálogo y «aprobadas» = elegibles. Sin lectura del motor, un hueco («—»), no el 0 de Supabase.
    const engine = engineViews.get(source) ?? null;
    const engineOnly = (ROUTES.get(source) ?? [])[0]?.provider === 'engine';
    const engineLost = engineOnly && engine === null && !engineFunnel;
    const shownSeen = engine ? engine.catalog : engineLost ? null : seen, shownApproved = engine ? engine.eligible : engineLost ? null : approved;
    const sample = sampleRow({ source, seen: shownSeen, approved: shownApproved, cost_usd: windowedCost(from, cost === null ? null : usd === undefined ? null : usd) }, from);
    let health: SourceHealth | null = null;
    const routes = ROUTES.get(source);
    if (routes && state) {
      const steps = planCascade(routes, state);
      const firstBlocked = steps.find(step => !step.ready && step.route.evidence !== 'bloqueado' && step.route.provider !== 'agent');
      const sourceActors = (Array.isArray(actors) ? actors as Array<ApifyActorLite & { source: string }> : []).filter(actor => actor.source === source);
      const ids = new Set(sourceActors.map(actor => actor.id));
      const sourceRuns: ApifyRunLite[] = (recentRuns ?? []).filter(run => ids.has(run.actor_id)).map(run => ({ actor_id: run.actor_id, status: run.status, items: run.harvested, error: run.error, started_at: run.started_at }));
      health = classifySource({ source, routes, ready: steps.some(step => step.ready), notReadyReason: firstBlocked?.reason ?? '', actors: sourceActors, runs: recentRuns === null ? [] : sourceRuns, seen, drafts });
    }
    if (engine) health = engineHealth(source, engine);
    else if (engineLost) health = { source, state: 'mal_conectada', cause: engineUrl ? 'No se pudo leer el estado del motor: no se sabe si recoge.' : 'Falta CAREER_ENGINE_URL en el servidor: no se puede medir.', next: engineUrl ? 'Mirar si el motor responde (Resumen) y reintentar.' : 'Configurar CAREER_ENGINE_URL (la dirección del motor).' };
    return { ...sample, health, drafts, engine };
  }));
  rows.sort((a, b) => (b.seen ?? -1) - (a.seen ?? -1) || a.source.localeCompare(b.source));
  return {
    target: SAMPLE_TARGET, rows,
    basis: 'ofertas únicas recogidas por fuente (una oferta vista varias veces cuenta una)',
    cost_note: cost === null
      ? 'No se pudo leer el coste registrado: la columna de coste y de aprobadas por dólar sale en «—».'
      : Object.values(since).some(Boolean) ? 'Las fuentes con fecha de corte muestran el coste en «—»: el coste registrado es acumulado y no se mezcla con lo recogido desde esa fecha.' : null,
    engine_note: engineUrl ? (engineFunnel ? 'Las gratuitas del motor muestran lo que el propio motor informa: «Recogidas» es su catálogo y «Aprobadas» son las elegibles (cumplen perfil, mercado, idioma y enlace).' : 'No se pudo leer el estado del motor: sus fuentes gratuitas salen en «—», no en 0.') : 'Falta CAREER_ENGINE_URL en el servidor: las fuentes gratuitas del motor no se pueden medir.',
    engine_run: engineFunnel?.last_run ? { day: typeof engineFunnel.last_run.day === 'string' ? engineFunnel.last_run.day : null, status: typeof engineFunnel.last_run.status === 'string' ? engineFunnel.last_run.status : null } : null,
    health_note: !state ? 'No se pudieron leer las claves guardadas: la columna «Conexión» sale en «—».' : recentRuns === null ? 'No se pudieron leer las ejecuciones de Apify: «Conexión» no puede detectar fallos de Apify.' : null,
  };
}

export { fmtInt };
