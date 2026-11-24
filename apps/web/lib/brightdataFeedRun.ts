import { ingest, ORG, recordSpend } from './external';
import { spendNote } from './providerBudget';
import { callTimeout, timeLeft } from './cronBudget';
import { serviceRest } from './supabaseAuth';
import { getSecret } from './integrations';
import type { Meter } from './providerCaps';
import { BrightDataError, parseBrightDataSecret } from './providers/brightdata';
import { FEEDS, feedCandidates, feedCollect, feedInput, feedTrigger, type FeedId } from './providers/brightdataFeeds';
import { MARKETS, dayOf, planSearches } from './searchBank';

// Feeds estructurados de Bright Data en el cron: se PIDE una búsqueda (se cobra por registro entregado; aquí se anota la
// estimación máxima = límite × tarifa) y se RECOGE en una pasada posterior (gratis). Cada encargo y cada recogida quedan
// anotados en `external_ingest_runs` (fuente `brightdata-feed`, vías `feed` y `feed-done`): el historial es la prueba de qué
// se pidió, qué se pagó y qué llegó. Lo que aún no está listo se deja para la siguiente pasada sin volver a pagar.

export const FEED_LEDGER = 'brightdata-feed';
const VIA_SUBMIT = 'feed', VIA_DONE = 'feed-done';
const KEEP_MS = 48 * 3_600_000;
const ID_RE = /snapshot_id=([A-Za-z0-9_-]{4,128})/;
const FEED_RE = /feed=([a-z]+)/;
const MARKET_ROTATION = ['es', 'mx', 'co', 'es', 'ar', 'cl', 'remote', 'pe'] as const;

export const feedMaxSearches = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.BRIGHTDATA_FEED_MAX_SEARCHES ?? 1);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), 4) : 1;
};
export const feedLimit = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.BRIGHTDATA_FEED_LIMIT ?? 30);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 100) : 30;
};

export type PendingFeed = { id: string; feed: FeedId };
/** Encargos de las últimas 48 h sin recoger, el más antiguo primero. `null` si el historial no se pudo leer. */
export async function pendingFeeds(now = Date.now()): Promise<PendingFeed[] | null> {
  const since = encodeURIComponent(new Date(now - KEEP_MS).toISOString());
  const response = await serviceRest(`external_ingest_runs?org_id=eq.${ORG}&source=eq.${FEED_LEDGER}&via=in.(${VIA_SUBMIT},${VIA_DONE})&created_at=gte.${since}&select=via,note&order=created_at.asc&limit=1000`).catch(() => null);
  if (!response?.ok) return null;
  const rows = await response.json().catch(() => null) as Array<{ via: string; note: string | null }> | null;
  if (!Array.isArray(rows)) return null;
  const submitted: PendingFeed[] = [];
  const done = new Set<string>();
  for (const row of rows) {
    const id = ID_RE.exec(row.note ?? '')?.[1];
    if (!id) continue;
    if (row.via === VIA_DONE) done.add(id);
    else if (!submitted.some(item => item.id === id)) {
      const feed = FEED_RE.exec(row.note ?? '')?.[1];
      if (feed && feed in FEEDS) submitted.push({ id, feed: feed as FeedId });
    }
  }
  return submitted.filter(item => !done.has(item.id));
}

const markDone = (id: string, feed: FeedId, outcome: string) => recordSpend(FEED_LEDGER, VIA_DONE, `snapshot_id=${id} · feed=${feed} · ${outcome}`.slice(0, 900)).catch(() => false);

export type FeedCollectOutcome = { checked: number; collected: number; accepted: number; received: number; pending: number; errors: string[]; unreadable?: boolean; truncated?: boolean };

/** Recoge lo que Bright Data ya tenga listo (gratis) y lo guarda como borradores de `brightdata-<fuente>`. */
export async function collectFeeds(apiKey: string, options: { via?: string; deadline?: number; limit?: number; fetchImpl?: typeof fetch; now?: number } = {}): Promise<FeedCollectOutcome> {
  const { via = 'cron', deadline, limit = 6, fetchImpl, now = Date.now() } = options;
  const out: FeedCollectOutcome = { checked: 0, collected: 0, accepted: 0, received: 0, pending: 0, errors: [] };
  const pending = await pendingFeeds(now);
  if (pending === null) return { ...out, unreadable: true, errors: ['No se pudo leer el historial de encargos de Bright Data.'] };
  for (const item of pending.slice(0, limit)) {
    if (timeLeft(deadline) < 2_500) { out.truncated = true; break; }
    out.checked++;
    const spec = FEEDS[item.feed];
    const result = await feedCollect(apiKey, item.id, { fetchImpl, timeoutMs: callTimeout(15_000, deadline) });
    if (result.status === 'pending') { out.pending++; continue; }
    if (result.status === 'gone' || result.status === 'failed') { out.errors.push(result.detail); await markDone(item.id, item.feed, `${result.status}: ${result.detail}`); continue; }
    if (result.status !== 'ready') { out.errors.push(result.status === 'error' ? result.detail : 'estado desconocido'); continue; }
    const candidates = feedCandidates(spec, result.records, now);
    try {
      const saved = candidates.length ? await ingest(spec.source, via, candidates, `${spec.label} (feed)`) : { accepted: 0 };
      out.collected++; out.accepted += saved.accepted; out.received += result.records.length;
      await markDone(item.id, item.feed, `recogido · ${result.records.length} registros · ${candidates.length} con título y enlace`);
    } catch (err) {
      out.errors.push(String((err as Error)?.message ?? err));
      // No se marca como hecho: se reintenta en la siguiente pasada (la descarga es gratis).
    }
  }
  return out;
}

export type FeedRunOutcome = { ok: boolean; error?: string; searches: number; cost_usd: number; queries: string[]; snapshots: string[]; collected: FeedCollectOutcome | null; accepted: number; truncated?: boolean; spend_unrecorded?: boolean };

/** Resuelve la API key de Bright Data (formato `API key[:zona…]`). `null` si no hay o no es utilizable. */
export async function feedApiKey(): Promise<string | null> {
  const secret = await getSecret('brightdata').catch(() => null);
  return secret ? parseBrightDataSecret(secret)?.apiKey ?? null : null;
}

/**
 * Etapa del cron: recoge lo pendiente (gratis) y, si hay objetivo y tope, pide hasta `maxSearches` búsquedas nuevas con el
 * banco de términos (perfil y mercado rotan por día). `limit` por búsqueda acota el coste: el tope se reserva ANTES de pedir.
 */
export async function runFeedStage(via: string, deadline: number | undefined, meter: Meter | null, options: { maxSearches?: number; now?: number; fetchImpl?: typeof fetch; feed?: FeedId; route?: 'cascada' | 'prueba'; limit?: number } = {}): Promise<FeedRunOutcome> {
  const out: FeedRunOutcome = { ok: false, searches: 0, cost_usd: 0, queries: [], snapshots: [], collected: null, accepted: 0 };
  const apiKey = await feedApiKey();
  if (!apiKey) return { ...out, error: 'Sin clave de Bright Data.' };
  const now = options.now ?? Date.now();
  out.collected = await collectFeeds(apiKey, { via, deadline, fetchImpl: options.fetchImpl, now });
  out.accepted += out.collected.accepted;
  const max = options.maxSearches === undefined ? feedMaxSearches() : Math.min(feedMaxSearches(), Math.max(0, Math.floor(options.maxSearches)));
  const limit = options.limit ?? feedLimit();
  const feed = FEEDS[options.feed ?? 'linkedin'];
  const price = Math.round(limit * feed.usdPerRecord * 1e6) / 1e6;
  const pendingNow = await pendingFeeds(now);
  // Un encargo aún en marcha basta: no se acumulan encargos sin recoger (se pagarían dos veces lo mismo).
  const already = pendingNow?.filter(item => item.feed === feed.id).length ?? 0;
  for (let i = 0; i < max && already + out.searches < 1; i++) {
    if (timeLeft(deadline) < 4_000) { out.truncated = true; break; }
    if (meter) {
      const check = meter.check('brightdata');
      if (!check.ok) { out.error = check.reason ?? 'Tope mensual de Bright Data agotado.'; break; }
      const room = meter.global.check(price);
      if (!room.ok) { out.error = room.reason ?? 'Tope global del mes alcanzado.'; break; }
    }
    const market = MARKETS[MARKET_ROTATION[(dayOf(now) + i) % MARKET_ROTATION.length]];
    const planned = planSearches({ now: now + i * 86_400_000, count: 1, market })[0];
    if (!planned) continue;
    try {
      const { snapshotId } = await feedTrigger(apiKey, feed, [feedInput(feed.id, { term: planned.term, market, timeRange: 'Past week' })], { limitPerInput: limit, fetchImpl: options.fetchImpl, timeoutMs: callTimeout(20_000, deadline) });
      out.searches++; out.cost_usd += price; out.snapshots.push(snapshotId); out.queries.push(`${planned.term} · ${market.label}`);
      meter?.charge('brightdata', price);
      const noted = await recordSpend(FEED_LEDGER, VIA_SUBMIT, [
        spendNote({ route: options.route ?? 'cascada', provider: 'brightdata', requests: 1, costUsd: price, detail: `${feed.id} feed (estimación máxima ${limit} registros)` }),
        `snapshot_id=${snapshotId}`, `feed=${feed.id}`, `q=${encodeURIComponent(planned.term)}|${market.id}`,
      ].join(' · '));
      if (!noted) out.spend_unrecorded = true;
    } catch (err) {
      out.error = err instanceof BrightDataError ? err.message : String((err as Error)?.message ?? err);
      break;
    }
  }
  out.cost_usd = Math.round(out.cost_usd * 1e6) / 1e6;
  out.ok = out.searches > 0 || (out.collected?.collected ?? 0) > 0 || (!out.error && already > 0);
  if (out.ok) delete out.error;
  if (!out.ok && !out.error) out.error = 'No se pidió ninguna búsqueda (ya hay un encargo en marcha o el tope no lo permite).';
  return out;
}
