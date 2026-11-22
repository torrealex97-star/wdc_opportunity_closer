import { ingest, ORG, recordSpend } from './external';
import { spendNote } from './providerBudget';
import { BRIGHTDATA_USD_PER_REQUEST, brightDataSource, BrightDataError, parseSerpJobs, serpCollectAsync, type FetchLike } from './providers/brightdata';
import { serviceRest } from './supabaseAuth';
import { timeLeft } from './cronBudget';

// Encargos asíncronos de Google Jobs en Bright Data. Encargar se cobra; recoger no. Cada encargo queda anotado en
// `external_ingest_runs` (fuente `brightdata-google`, vía `async`) con su coste —el medidor del tope lo suma como
// cualquier gasto— y su `async_id`; al recogerlo se añade otra fila (vía `async-done`) con el resultado. Las filas
// no se editan: el historial es la prueba de qué se pidió, qué se pagó y qué llegó. Bright Data guarda el
// resultado 48 h; lo que no esté listo en una pasada se recoge en la siguiente sin volver a pagar.

export const ASYNC_SOURCE = brightDataSource('google');
const PROBE_SOURCE = 'brightdata-probe';
const VIA_SUBMIT = 'async';
const VIA_DONE = 'async-done';
const KEEP_MS = 48 * 3_600_000;
const ID_RE = /async_id=([A-Za-z0-9_-]{4,128})/;

export type AsyncDork = { q: string; gl: string; hl: string };

/** Anota un encargo (y su coste). `false` si no se pudo anotar: el llamador lo declara como gasto sin anotar. */
export function rememberSubmit(id: string, dork: AsyncDork, route: 'cascada' | 'prueba'): Promise<boolean> {
  const note = [
    spendNote({ route, provider: 'brightdata', requests: 1, costUsd: BRIGHTDATA_USD_PER_REQUEST, detail: 'google-jobs asíncrono' }),
    `async_id=${id}`,
    `dork=${encodeURIComponent(dork.q)}|${dork.gl}|${dork.hl}`,
  ].join(' · ');
  // Los encargos de «Probar» conservan su fuente de siempre (`brightdata-probe`); la recogida mira las dos.
  return recordSpend(route === 'prueba' ? PROBE_SOURCE : ASYNC_SOURCE, VIA_SUBMIT, note).catch(() => false);
}

export const markDone = (id: string, outcome: string) => recordSpend(ASYNC_SOURCE, VIA_DONE, `async_id=${id} · ${outcome}`.slice(0, 900)).catch(() => false);

/** Encargos de las últimas 48 h aún sin recoger, el más antiguo primero. `null` si el historial no se pudo leer. */
export async function pendingAsync(now = Date.now()): Promise<string[] | null> {
  const since = encodeURIComponent(new Date(now - KEEP_MS).toISOString());
  const response = await serviceRest(`external_ingest_runs?org_id=eq.${ORG}&source=in.(${ASYNC_SOURCE},${PROBE_SOURCE})&via=in.(${VIA_SUBMIT},${VIA_DONE})&created_at=gte.${since}&select=via,note&order=created_at.asc&limit=1000`).catch(() => null);
  if (!response?.ok) return null;
  const rows = await response.json().catch(() => null) as Array<{ via: string; note: string | null }> | null;
  if (!Array.isArray(rows)) return null;
  const submitted: string[] = [];
  const done = new Set<string>();
  for (const row of rows) {
    const id = ID_RE.exec(row.note ?? '')?.[1];
    if (!id) continue;
    if (row.via === VIA_DONE) done.add(id);
    else if (!submitted.includes(id)) submitted.push(id);
  }
  return submitted.filter(id => !done.has(id));
}

export type AsyncCollectOutcome = { checked: number; collected: number; accepted: number; pending: number; gone: number; errors: string[]; unreadable?: boolean; truncated?: boolean };

/**
 * Recoge lo que Bright Data ya tenga listo (gratis) y lo guarda como borradores de `brightdata-google`. Lo que
 * sigue procesando se deja para la siguiente pasada. Respeta el reloj compartido del cron.
 */
export async function collectAsync(apiKey: string, options: { via?: string; deadline?: number; limit?: number; ids?: string[]; fetchImpl?: FetchLike; now?: number } = {}): Promise<AsyncCollectOutcome> {
  const { via = 'cron', deadline, limit = 8, fetchImpl, now = Date.now() } = options;
  const out: AsyncCollectOutcome = { checked: 0, collected: 0, accepted: 0, pending: 0, gone: 0, errors: [] };
  const ids = options.ids ?? await pendingAsync(now);
  if (ids === null) return { ...out, unreadable: true, errors: ['No se pudo leer el historial de encargos asíncronos.'] };
  for (const id of ids.slice(0, limit)) {
    if (timeLeft(deadline) < 2_500) { out.truncated = true; break; }
    out.checked++;
    const result = await serpCollectAsync(apiKey, id, { fetchImpl, timeoutMs: Math.max(1_000, Math.min(12_000, Math.floor(timeLeft(deadline) - 500))) });
    if (result.status === 'pending') { out.pending++; continue; }
    if (result.status === 'error') { out.errors.push(result.detail); continue; }
    if (result.status === 'gone') { out.gone++; await markDone(id, 'caducado: Bright Data ya no lo tiene'); continue; }
    try {
      const parsed = parseSerpJobs(result.text, 1, now);
      const saved = parsed.candidates.length ? await ingest(ASYNC_SOURCE, via, parsed.candidates, 'Google Jobs vía Bright Data (asíncrono)') : { accepted: 0 };
      out.collected++; out.accepted += saved.accepted;
      await markDone(id, `recogido · ${parsed.candidates.length} ofertas${parsed.hasJobsPanel ? '' : ' · sin panel de empleos'}`);
    } catch (err) {
      const detail = err instanceof BrightDataError ? err.message : String((err as Error)?.message ?? err);
      out.errors.push(detail);
      await markDone(id, `ilegible: ${detail}`);
    }
  }
  if (ids.length > limit) out.truncated = true;
  return out;
}

/** Recoge los encargos pendientes con la clave guardada. `null` si no hay clave de Bright Data o no es legible. */
export async function collectBrightAsync(via: string, deadline?: number): Promise<AsyncCollectOutcome | null> {
  const { getSecret } = await import('./integrations');
  const { parseBrightDataSecret } = await import('./providers/brightdata');
  const secret = await getSecret('brightdata').catch(() => null);
  const parsed = secret ? parseBrightDataSecret(secret) : null;
  if (!parsed) return null;
  return collectAsync(parsed.apiKey, { via, deadline });
}
