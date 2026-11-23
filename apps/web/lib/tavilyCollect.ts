import { getSecret } from './integrations';
import { ingest, pausedSourcesStrict, recordSpend } from './external';
import { callTimeout, timeLeft } from './cronBudget';
import type { Meter } from './providerCaps';
import { spendNote } from './providerBudget';
import { TAVILY_USD_PER_CREDIT, TavilyError, tavilyCandidates, tavilyDomains, tavilySearch } from './providers/tavily';
import { DATE_WINDOWS, MARKETS, buildQuery, planSearches, dayOf } from './searchBank';

// Etapa Tavily del waterfall: unas pocas búsquedas semánticas por pasada, con el banco de términos (`searchBank`), solo
// mientras falte objetivo y quede tope. Rota mercado (España, México, Colombia, remoto en inglés) y perfil por día.
// Las ofertas se guardan con la fuente `tavily`; el panel mide cuánto aporta. Máximo: TAVILY_MAX_SEARCHES (2 por
// defecto, 0 = apagado). La clave sale de la conexión `tavily` o, si no hay, de la variable TAVILY_API_KEY.

const MARKET_ROTATION = ['es', 'mx', 'co', 'es', 'ar'] as const;
export const TAVILY_SOURCE = 'tavily';
export const tavilyMaxSearches = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.TAVILY_MAX_SEARCHES ?? 2);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), 8) : 2;
};
export const tavilyKey = async (env: NodeJS.ProcessEnv = process.env): Promise<string | null> =>
  (await getSecret('tavily').catch(() => null)) ?? (env.TAVILY_API_KEY?.trim() || null);

export type TavilyOutcome = { source: 'tavily'; ok: boolean; error?: string; searches: number; cost_usd: number; accepted: number; received: number; truncated?: boolean; spend_unrecorded?: boolean; queries: string[] };

export async function collectTavily(via: string, deadline: number | undefined, meter: Meter, options: { now?: number; maxSearches?: number } = {}): Promise<TavilyOutcome> {
  const out: TavilyOutcome = { source: 'tavily', ok: false, searches: 0, cost_usd: 0, accepted: 0, received: 0, queries: [] };
  const max = options.maxSearches === undefined ? tavilyMaxSearches() : Math.min(tavilyMaxSearches(), Math.max(0, Math.floor(options.maxSearches)));
  if (max === 0) return { ...out, error: 'Tavily desactivado (TAVILY_MAX_SEARCHES=0).' };
  const key = await tavilyKey();
  if (!key) return { ...out, error: 'Sin clave de Tavily.' };
  const paused = await pausedSourcesStrict();
  if (!paused) return { ...out, error: 'No se pudo comprobar qué fuentes están pausadas; se reintenta en la próxima ejecución.' };
  if (paused.has(TAVILY_SOURCE)) return { ...out, error: 'La fuente Tavily está pausada.' };
  const now = options.now ?? Date.now();
  const price = TAVILY_USD_PER_CREDIT;
  const domains = tavilyDomains();
  for (let i = 0; i < max; i++) {
    if (timeLeft(deadline) < 3_000) { out.truncated = true; break; }
    const check = meter.check('tavily');
    if (!check.ok) { out.error = check.reason ?? 'Tope mensual de Tavily agotado.'; break; }
    const room = meter.global.check(price);
    if (!room.ok) { out.error = room.reason ?? 'Tope global del mes alcanzado.'; break; }
    const market = MARKETS[MARKET_ROTATION[(dayOf(now) + i) % MARKET_ROTATION.length]];
    const planned = planSearches({ now: now + i * 86_400_000, count: 1, market })[0];
    if (!planned) continue;
    const query = buildQuery('semantic', planned.term, { market });
    try {
      const result = await tavilySearch(key, query, { maxResults: 10, timeRange: DATE_WINDOWS.week.tavily, country: market.tavily, domains, timeoutMs: callTimeout(12_000, deadline) });
      out.searches++; out.queries.push(query); meter.charge('tavily', price);
      const candidates = tavilyCandidates(result.results);
      out.received += result.results.length;
      const saved = candidates.length ? await ingest(TAVILY_SOURCE, via, candidates, `Tavily · ${query}`) : { accepted: 0 };
      out.accepted += saved.accepted;
    } catch (err) {
      const e = err as TavilyError;
      out.error = e.message;
      if (e.billed) { out.searches++; meter.charge('tavily', price); }
      // Clave rechazada, límite o crédito agotado: no se insiste en esta pasada.
      if (e.status === 401 || e.status === 429 || e.status === 432 || e.status === 433) break;
    }
  }
  out.cost_usd = Math.round(out.searches * price * 1e6) / 1e6;
  if (out.searches > 0) {
    const noted = await recordSpend(TAVILY_SOURCE, via, spendNote({ route: 'cascada', provider: 'tavily', requests: out.searches, costUsd: out.cost_usd, detail: out.queries.join(' | ').slice(0, 200) }));
    if (!noted) out.spend_unrecorded = true;
  }
  out.ok = out.accepted > 0 || (out.searches > 0 && !out.error);
  if (out.ok) delete out.error;
  if (!out.ok && !out.error) out.error = 'Tavily no hizo ninguna búsqueda.';
  return out;
}
