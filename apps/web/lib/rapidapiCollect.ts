import { getSecret } from './integrations';
import { ingest, pausedSourcesStrict, recordSpend } from './external';
import { callTimeout, timeLeft } from './cronBudget';
import type { Meter } from './providerCaps';
import { spendNote } from './providerBudget';
import { RAPIDAPI_JOB_APIS, RapidApiError, rapidApiJobs, rapidApiUsdPerRequest } from './providers/rapidapi';

// Etapa RapidAPI del waterfall: unas pocas búsquedas por pasada en las APIs de empleo verificadas, solo mientras
// falte objetivo y quede tope. Cada API guarda sus ofertas con su propia fuente (`rapidapi-<api>`) para que el
// panel de fuentes mida cuál aporta. Una API sin suscripción (403) se salta sin cobrarse; un fallo no oculta las
// demás. Máximo de peticiones por pasada: RAPIDAPI_MAX_REQUESTS (3 por defecto, 0 = apagado).

const QUERIES = [
  { q: 'closer de ventas', gl: 'es' },
  { q: 'closer high ticket', gl: 'es' },
  { q: 'setter closer remoto', gl: 'es' },
];
export const rapidApiMaxRequests = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.RAPIDAPI_MAX_REQUESTS ?? 3);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), 12) : 3;
};

export type RapidApiOutcome = { source: 'rapidapi'; ok: boolean; error?: string; requests: number; cost_usd: number; accepted: number; by_api: Record<string, { requests: number; accepted: number; error?: string }>; truncated?: boolean; spend_unrecorded?: boolean };

export async function collectRapidApi(via: string, deadline: number | undefined, meter: Meter, options: { now?: number } = {}): Promise<RapidApiOutcome> {
  const out: RapidApiOutcome = { source: 'rapidapi', ok: false, requests: 0, cost_usd: 0, accepted: 0, by_api: {} };
  const max = rapidApiMaxRequests();
  if (max === 0) return { ...out, error: 'RapidAPI desactivado (RAPIDAPI_MAX_REQUESTS=0).' };
  const key = await getSecret('rapidapi').catch(() => null);
  if (!key) return { ...out, error: 'Sin clave de RapidAPI.' };
  const paused = await pausedSourcesStrict();
  if (!paused) return { ...out, error: 'No se pudo comprobar qué fuentes están pausadas; se reintenta en la próxima ejecución.' };
  const price = rapidApiUsdPerRequest();
  const skip = new Set<string>();
  const day = Math.floor((options.now ?? Date.now()) / 86_400_000);
  for (let i = 0; out.requests < max && i < RAPIDAPI_JOB_APIS.length * QUERIES.length; i++) {
    const api = RAPIDAPI_JOB_APIS[i % RAPIDAPI_JOB_APIS.length];
    if (skip.has(api.id) || paused.has(`rapidapi-${api.id}`)) continue;
    if (timeLeft(deadline) < 3_000) { out.truncated = true; break; }
    const check = meter.check('rapidapi');
    if (!check.ok) { out.error = check.reason ?? 'Tope mensual de RapidAPI agotado.'; break; }
    // Rota la búsqueda por día para no pedir siempre lo mismo.
    const query = QUERIES[(day + Math.floor(i / RAPIDAPI_JOB_APIS.length)) % QUERIES.length];
    const row = out.by_api[api.id] ?? { requests: 0, accepted: 0 };
    out.by_api[api.id] = row;
    try {
      const result = await rapidApiJobs(key, api, query.q, query.gl, { timeoutMs: callTimeout(12_000, deadline) });
      out.requests++; row.requests++; meter.charge('rapidapi', price);
      const saved = result.candidates.length ? await ingest(`rapidapi-${api.id}`, via, result.candidates, `${api.label} vía RapidAPI`) : { accepted: 0 };
      row.accepted += saved.accepted; out.accepted += saved.accepted;
    } catch (err) {
      const e = err as RapidApiError;
      row.error = e.message;
      if (e.billed) { out.requests++; row.requests++; meter.charge('rapidapi', price); }
      // Sin suscripción, clave rechazada o cuota agotada: esa API no se vuelve a pedir en esta pasada.
      if (e.status === 401 || e.status === 403 || e.status === 429) skip.add(api.id);
      if (e.status === 401) break;
    }
  }
  out.cost_usd = Math.round(out.requests * price * 1e6) / 1e6;
  for (const [apiId, row] of Object.entries(out.by_api)) {
    if (!row.requests) continue;
    const noted = await recordSpend(`rapidapi-${apiId}`, via, spendNote({ route: 'cascada', provider: 'rapidapi', requests: row.requests, costUsd: Math.round(row.requests * price * 1e6) / 1e6, detail: apiId }));
    if (!noted) out.spend_unrecorded = true;
  }
  out.ok = out.accepted > 0 || Object.values(out.by_api).some(row => row.requests > 0 && !row.error);
  if (!out.ok && !out.error) out.error = Object.values(out.by_api).map(row => row.error).filter(Boolean).join(' · ') || 'Ninguna API de RapidAPI respondió.';
  return out;
}
