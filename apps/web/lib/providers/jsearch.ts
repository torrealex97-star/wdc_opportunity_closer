import type { Candidate } from '../external';

// JSearch de OpenWeb Ninja: Google for Jobs por API propia, con la forma documentada en
// `api.openwebninja.com/jsearch/search-v2` (`x-api-key`, respuesta `{ status, data: { jobs } }`).
//
// Es el escalón que faltaba entre Bright Data (0,0015 USD) y SerpApi (0,025 USD): la misma búsqueda
// cuesta 0,0025 USD por petición (25 USD por 10.000; 200 gratis al mes), así que el orden por coste no
// cambia y SerpApi queda como último respaldo de Google Jobs.
//
// Una petición = una página de hasta 10 ofertas. Aquí se pide `num_pages=1` y sin cursor: paginar
// multiplica el gasto y no se hace sin que el operador lo pida.
export const JSEARCH_USD_PER_REQUEST = 0.0025;

export const JSEARCH_DEFAULT_BASE = 'https://api.openwebninja.com/jsearch';

/** Base configurable solo para pruebas y espejos; por defecto, la de OpenWeb Ninja. */
export const jsearchBase = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.JSEARCH_API_BASE ?? JSEARCH_DEFAULT_BASE).replace(/\/+$/, '');

export type JSearchQuery = { query: string; country?: string; language?: string; datePosted?: 'all' | 'today' | '3days' | 'week' | 'month' };

export function jsearchUrl(input: JSearchQuery, env: NodeJS.ProcessEnv = process.env): string {
  const params = new URLSearchParams({
    query: input.query,
    country: input.country ?? 'es',
    language: input.language ?? 'es',
    num_pages: '1',
    date_posted: input.datePosted ?? 'week',
  });
  return `${jsearchBase(env)}/search-v2?${params.toString()}`;
}

/** Error con el estado HTTP cuando lo hubo: sin estado (red, timeout) no se puede afirmar que se cobró. */
export class JSearchError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'JSearchError';
    this.status = status;
  }
}

/**
 * Las ofertas del cuerpo documentado (`data.jobs`). El endpoint antiguo `/search` devolvía `data` como
 * lista y `data[].jobs[]`; se aceptan las dos formas para no romper con una respuesta mixta.
 */
export function jobsFromPayload(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as Record<string, unknown>).data;
  if (Array.isArray(data)) {
    return data.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const nested = (item as Record<string, unknown>).jobs;
      return Array.isArray(nested) ? nested : [item];
    });
  }
  if (data && typeof data === 'object') {
    const jobs = (data as Record<string, unknown>).jobs;
    if (Array.isArray(jobs)) return jobs;
  }
  const jobs = (payload as Record<string, unknown>).jobs;
  return Array.isArray(jobs) ? jobs : [];
}

/** Mensaje del proveedor cuando no es 2xx; nunca se inventa uno. */
const errorText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  for (const value of [body.message, body.error, body.detail]) {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  }
  const status = typeof body.status === 'string' ? body.status : '';
  return status && !/^ok$/i.test(status) ? `estado ${status}` : null;
};

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

/**
 * Enlace de la oferta. JSearch lo publica a veces sin esquema («linkedin.com/jobs/…»): se le añade
 * `https://` solo si parece un dominio, y si no es http(s) se descarta en vez de guardar basura.
 */
export const httpUrl = (value: unknown): string | null => {
  const text = clip(value, 2_000);
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : /^[\w-]+(\.[\w-]+)+\//.test(text) ? `https://${text}` : null;
  if (!withScheme || !/^https?:\/\/[^\s]+$/i.test(withScheme)) return null;
  try { new URL(withScheme); return withScheme; } catch { return null; }
};

const PERIODS: Record<string, string> = { year: 'año', month: 'mes', week: 'semana', day: 'día', hour: 'hora' };

/** Salario solo cuando el proveedor da cifras; no se rellena con estimaciones ni se inventa moneda. */
export function salaryText(row: Record<string, unknown>): string | null {
  const min = typeof row.job_min_salary === 'number' ? row.job_min_salary : null;
  const max = typeof row.job_max_salary === 'number' ? row.job_max_salary : null;
  if (min === null && max === null) return null;
  const currency = clip(row.job_salary_currency, 8);
  const period = clip(row.job_salary_period, 12);
  const range = min !== null && max !== null && max !== min ? `${min}–${max}` : `${min ?? max}`;
  const per = period ? (PERIODS[period.toLowerCase()] ?? period.toLowerCase()) : null;
  return [range, currency, per ? `por ${per}` : null].filter(Boolean).join(' ').slice(0, 200);
}

/** Ubicación con lo que trae: `job_location` o la terna ciudad/estado/país. */
export function locationText(row: Record<string, unknown>): string | null {
  const direct = clip(row.job_location, 200);
  if (direct) return direct;
  const parts = [row.job_city, row.job_state, row.job_country].map(part => clip(part, 80)).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

const postedAt = (row: Record<string, unknown>): string | null => {
  const iso = clip(row.job_posted_at_datetime_utc, 40);
  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const stamp = row.job_posted_at_timestamp;
  if (typeof stamp === 'number' && Number.isFinite(stamp)) {
    // La documentación lo da en segundos; milisegundos se reconocen por tamaño.
    const ms = stamp > 1e12 ? stamp : stamp * 1000;
    return new Date(ms).toISOString();
  }
  return null;
};

/** Una oferta de JSearch, tal como la documenta el proveedor. Sin enlace o título no hay oferta. */
export function jobToCandidate(row: unknown): Candidate | null {
  if (!row || typeof row !== 'object') return null;
  const job = row as Record<string, unknown>;
  const applies = Array.isArray(job.apply_options) ? job.apply_options : [];
  const first = applies[0] && typeof applies[0] === 'object' ? applies[0] as Record<string, unknown> : {};
  const url = httpUrl(job.job_apply_link) ?? httpUrl(first.apply_link);
  const title = clip(job.job_title, 200);
  if (!url || !title) return null;
  const publisher = clip(job.job_publisher, 80);
  return {
    external_id: clip(job.job_id, 200) ?? url,
    title,
    company: clip(job.employer_name, 200) ?? publisher,
    location: locationText(job),
    url,
    salary: salaryText(job),
    description: clip(job.job_description, 6_000),
    posted_at: postedAt(job),
    raw: { provider: 'jsearch', site: publisher ?? undefined, remote: job.job_is_remote === true || undefined },
  };
}

export function candidatesFromPayload(payload: unknown): Candidate[] {
  return jobsFromPayload(payload).map(jobToCandidate).filter((candidate): candidate is Candidate => candidate !== null);
}

export type JSearchResult = { candidates: Candidate[]; rawItems: number; requests: number; costUsd: number };

/**
 * Una búsqueda, una petición. Un 2xx se cobra aunque el cuerpo no traiga ofertas; un 401/403/429/5xx o un
 * fallo de red se declara con su estado, y quien llama decide si anotar el peor caso.
 */
export async function jsearchJobs(
  secret: string,
  input: JSearchQuery & { timeoutMs?: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<JSearchResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 20_000;
  const response = await doFetch(jsearchUrl(input, input.env), {
    headers: { 'x-api-key': secret, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err: unknown) => {
    throw new JSearchError(`No se pudo contactar con JSearch: ${(err as Error)?.message ?? 'fallo de red'}`, null);
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = errorText(payload);
    throw new JSearchError(`JSearch respondió HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status);
  }
  const error = errorText(payload);
  if (error) throw new JSearchError(`JSearch: ${error}`, response.status);
  const rows = jobsFromPayload(payload);
  return {
    candidates: candidatesFromPayload(payload),
    rawItems: rows.length,
    requests: 1,
    costUsd: JSEARCH_USD_PER_REQUEST,
  };
}
