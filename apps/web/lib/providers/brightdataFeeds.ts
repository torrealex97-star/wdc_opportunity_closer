import type { Candidate } from '../external';
import { apiBase, BrightDataError, type FetchLike } from './brightdata';
import type { Market } from '../searchBank';

// Feeds estructurados de Bright Data (Web Scraper API): scrapers de empleo ya hechos que devuelven registros con título,
// empresa, ubicación, fecha y descripción, sin depender de que Google muestre el panel de empleos (la vía `site:` falla
// con «sin panel de empleos»). Aquí solo se CONECTA: se pide, se recoge y se devuelven candidatos en bruto; nunca se
// escribe una oferta (eso lo hace `ingest`).
//
// Contrato leído en la documentación pública de Bright Data (2026-11-24; *inspected*, no probado contra el servicio):
//  - `scrapers.json` oficial: LinkedIn job listings = gd_lpfll7v5hcqtkxl6l; Indeed = gd_l4dx9j9sscpvs7no2; Glassdoor = gd_lpfbbndm1xnopbrcr0.
//  - Descubrir por palabra clave: POST /datasets/v3/trigger?dataset_id=…&type=discover_new&discover_by=keyword con
//    { input: [{ keyword, location, country, time_range, job_type, experience_level, remote, company, selective_search,
//    jobs_to_not_include, location_radius }], limit_per_input } → { snapshot_id }.
//  - Progreso: GET /datasets/v3/progress/{id} → { status: starting | running | ready | failed }; resultado: GET
//    /datasets/v3/snapshot/{id}?format=json (202 mientras se prepara). Se cobra por registro entregado.
// Indeed y Glassdoor NO están aquí: sus campos de entrada no se pudieron leer y no se inventan.

export type FeedId = 'linkedin';
export type FeedSpec = { id: FeedId; dataset: string; label: string; source: string; code: string; usdPerRecord: number };

/** Tarifa de partida (USD por registro entregado): estimación prudente para el tope, la real la factura Bright Data. */
export const FEED_USD_PER_RECORD = 0.0015;

export const FEEDS: Record<FeedId, FeedSpec> = {
  linkedin: { id: 'linkedin', dataset: 'gd_lpfll7v5hcqtkxl6l', label: 'LinkedIn Jobs · Bright Data', source: 'brightdata-linkedin', code: 'linkedin', usdPerRecord: FEED_USD_PER_RECORD },
};
export const isFeedSource = (code: string): code is FeedId => Object.prototype.hasOwnProperty.call(FEEDS, code);

/** Entrada de una búsqueda por palabra clave. `time_range` admite «Past 24 hours», «Past week» y «Past month». */
export function feedInput(feed: FeedId, search: { term: string; market: Market; timeRange?: 'Past 24 hours' | 'Past week' | 'Past month' }): Record<string, unknown> {
  if (feed === 'linkedin') {
    return { keyword: search.term, location: search.market.location, country: search.market.country, time_range: search.timeRange ?? 'Past week', selective_search: false };
  }
  throw new Error(`Sin entrada definida para ${feed}`);
}

export type FeedTrigger = { snapshotId: string };

export async function feedTrigger(apiKey: string, feed: FeedSpec, inputs: Array<Record<string, unknown>>, options: { limitPerInput?: number; fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<FeedTrigger> {
  const { fetchImpl = fetch, timeoutMs = 20_000, limitPerInput = 30 } = options;
  const params = new URLSearchParams({ dataset_id: feed.dataset, include_errors: 'true', type: 'discover_new', discover_by: 'keyword', notify: 'false' });
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/datasets/v3/trigger?${params}`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: inputs, limit_per_input: limitPerInput }),
    });
  } catch (err) {
    throw new BrightDataError(`No se pudo contactar con Bright Data: ${(err as Error).message}`, null, 1);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new BrightDataError(`Bright Data rechazó el encargo de ${feed.label} (HTTP ${response.status})${text ? `: ${text.slice(0, 160)}` : ''}`, response.status, 1);
  let id: unknown;
  try { id = (JSON.parse(text) as Record<string, unknown>).snapshot_id; } catch { /* sin JSON */ }
  if (typeof id === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(id)) return { snapshotId: id };
  throw new BrightDataError(`Bright Data no devolvió snapshot_id para ${feed.label}${text ? `: ${text.slice(0, 160)}` : ''}`, response.status, 1);
}

export type FeedCollect = { status: 'pending' } | { status: 'ready'; records: unknown[] } | { status: 'failed' | 'gone' | 'error'; detail: string };

/** Recoge un encargo (gratis). Nunca lanza: devuelve el estado para que el llamador decida. */
export async function feedCollect(apiKey: string, snapshotId: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<FeedCollect> {
  const { fetchImpl = fetch, timeoutMs = 20_000 } = options;
  const headers = { Authorization: `Bearer ${apiKey}` };
  const get = (path: string) => fetchImpl(`${apiBase()}${path}`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers });
  try {
    const progress = await get(`/datasets/v3/progress/${encodeURIComponent(snapshotId)}`);
    const pText = await progress.text().catch(() => '');
    if (progress.status === 404) return { status: 'gone', detail: 'Bright Data ya no tiene este encargo' };
    if (!progress.ok) return { status: 'error', detail: `Bright Data respondió HTTP ${progress.status} al pedir el progreso${pText ? `: ${pText.slice(0, 160)}` : ''}` };
    let state = '';
    try { state = String((JSON.parse(pText) as Record<string, unknown>).status ?? ''); } catch { /* sin JSON */ }
    if (state === 'failed') return { status: 'failed', detail: 'Bright Data marcó el encargo como fallido' };
    if (state !== 'ready') return { status: 'pending' };
    const snap = await get(`/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`);
    if (snap.status === 202) return { status: 'pending' };
    const sText = await snap.text().catch(() => '');
    if (!snap.ok) return { status: 'error', detail: `Bright Data respondió HTTP ${snap.status} al descargar${sText ? `: ${sText.slice(0, 160)}` : ''}` };
    let body: unknown;
    try { body = JSON.parse(sText); } catch {
      // NDJSON: un registro por línea.
      body = sText.split('\n').map(line => line.trim()).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    }
    if (!Array.isArray(body)) return { status: 'error', detail: 'Bright Data devolvió algo que no es una lista de registros: no se interpreta como 0 ofertas' };
    return { status: 'ready', records: body };
  } catch (err) {
    return { status: 'error', detail: `No se pudo contactar con Bright Data: ${(err as Error).message}` };
  }
}

const text = (value: unknown, max = 600): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const t = String(value).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const first = (row: Record<string, unknown>, keys: string[], max?: number) => { for (const k of keys) { const v = text(row[k], max); if (v) return v; } return null; };
const link = (value: unknown) => (typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim().slice(0, 1000) : null);

/**
 * Registros → candidatos. Solo los que traen título y un enlace http(s); los registros de error del scraper y los
 * demás se descartan. Empresa, ubicación, sueldo y fecha son «no indicado» (null) si el registro no los trae.
 */
export function feedCandidates(feed: FeedSpec, records: unknown[], now = Date.now()): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of records) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.error || row.error_code) continue;
    const title = first(row, ['job_title', 'title'], 200);
    const url = link(row.url) ?? link(row.apply_link) ?? link(row.job_url);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    const id = first(row, ['job_posting_id', 'jobid', 'id'], 120) ?? url;
    const posted = first(row, ['job_posted_date', 'date_posted_parsed', 'date_posted'], 40);
    const postedMs = posted ? Date.parse(posted) : NaN;
    out.push({
      external_id: `bd-${feed.id}-${id}`.slice(0, 200), title, company: first(row, ['company_name', 'company'], 200),
      location: first(row, ['job_location', 'location'], 200), url, apply_url: link(row.apply_link),
      salary: first(row, ['job_base_pay_range', 'salary_formatted', 'base_salary'], 200),
      description: first(row, ['job_summary', 'job_description_formatted', 'description_text', 'description'], 1500),
      posted_at: Number.isFinite(postedMs) && postedMs <= now + 86_400_000 ? new Date(postedMs).toISOString() : null,
      raw: { provider: 'brightdata-feed', feed: feed.id, dataset: feed.dataset, employment_type: first(row, ['job_employment_type', 'job_type'], 80) },
    });
  }
  return out;
}
