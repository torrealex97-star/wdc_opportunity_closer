import type { Candidate } from '../external';

// Bright Data · SERP API y Web Unlocker.
//
// Contrato contrastado con su documentación (docs.brightdata.com, SERP API → Google → Jobs y «Parsed JSON
// results»): `POST https://api.brightdata.com/request` con `Authorization: Bearer <API key>` y
// `{zone, url, format: "raw"}`. Para Google Jobs se pide la URL de Google con `ibp=htl%3Bjobs` **y
// `brd_json=1`**: ese parámetro de la URL es lo que devuelve el JSON parseado; sin él la respuesta es el
// HTML de Google. `format` NO activa el parseo: `raw` entrega el cuerpo tal cual y `json` lo envuelve en
// `{status_code, headers, body}` (aquí se desenvuelve por si una zona lo devuelve así). El JSON parseado
// trae `jobs.items[]` con título, empresa, ubicación, fuente, descripción, enlace y etiquetas. Precio de lista: 1,50 USD por 1.000 peticiones correctas
// (0,0015 USD cada una) y 5.000 créditos gratis al mes COMPARTIDOS entre sus productos.
//
// Lo que este módulo NO hace: inventar campos que la respuesta no trae. Sin enlace o sin título, el
// anuncio se descarta y se declara el descarte; empresa, ubicación y salario quedan como «no indicado»
// si no vienen. No hay ninguna llamada real en las pruebas: se usa un `fetch` simulado y un fixture
// con la forma documentada, y el panel lo marca «documentada · sin probar» hasta la primera ejecución
// con clave de verdad.

export const BRIGHTDATA_USD_PER_REQUEST = 0.0015;
export const BRIGHTDATA_FREE_MONTHLY_REQUESTS = 5000;
export const BRIGHTDATA_COST_NOTE = '1,50 USD por 1.000 peticiones correctas · 5.000 créditos gratis al mes compartidos entre sus APIs';

export type BrightDataConfig = {
  apiKey: string;
  serpZone: string;
  /** Zona del Web Unlocker; opcional porque solo hace falta para leer HTML de portales. */
  unlockerZone: string | null;
};

/** La clave se guarda como `API key:zona SERP[:zona Unlocker]`. Nada se deduce del nombre de la zona. */
export function parseBrightDataSecret(secret: string): BrightDataConfig | null {
  const parts = secret.trim().split(':').map(part => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const [apiKey, serpZone, unlockerZone] = parts;
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(apiKey)) return null;
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(serpZone)) return null;
  if (unlockerZone !== undefined && !/^[A-Za-z0-9_-]{2,80}$/.test(unlockerZone)) return null;
  return { apiKey, serpZone, unlockerZone: unlockerZone ?? null };
}

/** Nunca se imprime la clave: solo los últimos 4 caracteres, como el resto de proveedores. */
export const brightDataLast4 = (secret: string) => secret.trim().slice(-4);

export class BrightDataError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null = null, retryable = false) {
    super(message);
    this.name = 'BrightDataError';
    this.status = status;
    this.retryable = retryable;
  }
}

export const apiBase = () => process.env.BRIGHTDATA_API_BASE ?? 'https://api.brightdata.com';

/** Atribución por fuente: `brightdata-google` o `brightdata-<portal>` (p. ej. `brightdata-infojobs`). */
export const brightDataSource = (code: string) => `brightdata-${code}`;

/**
 * URL de Google Jobs: `ibp=htl;jobs` es el parámetro documentado para vacantes y `brd_json=1` el que pide
 * a Bright Data el JSON parseado en lugar del HTML de Google (sin él no hay `jobs.items[]`).
 */
export function googleJobsUrl(query: string, gl = 'es', hl = 'es'): string {
  const params = new URLSearchParams({ q: query, ibp: 'htl;jobs', hl, gl, brd_json: '1' });
  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * Cuerpo de la respuesta ya como objeto. Acepta el JSON parseado directo (`format: raw` + `brd_json=1`) y
 * la envoltura `{status_code, headers, body}` que devuelve `format: json`, cuyo `body` es otro JSON (si es
 * HTML no hay datos parseados y se declara en `serpJobs`).
 */
export function unwrapBody(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const outer = parsed as Record<string, unknown>;
  if (typeof outer.body === 'string' && ('status_code' in outer || 'headers' in outer)) {
    try {
      const inner = JSON.parse(outer.body);
      return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner as Record<string, unknown> : null;
    } catch { return null; }
  }
  return outer;
}

type FetchLike = typeof fetch;

async function postRequest(
  config: BrightDataConfig,
  zone: string,
  url: string,
  format: 'json' | 'raw',
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxAttempts = 2,
): Promise<{ text: string; status: number }> {
  let last: BrightDataError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase()}/request`, {
        method: 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ zone, url, format }),
      });
    } catch (err) {
      last = new BrightDataError(`No se pudo contactar con Bright Data: ${(err as Error).message}`, null, true);
      if (attempt < maxAttempts - 1) continue;
      throw last;
    }
    const text = await response.text().catch(() => '');
    if (response.ok) return { text, status: response.status };
    const retryable = response.status === 429 || response.status >= 500;
    last = new BrightDataError(`Bright Data respondió HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`, response.status, retryable);
    // Un 401/403 no mejora reintentando: la clave o la zona están mal.
    if (!retryable || attempt >= maxAttempts - 1) throw last;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw last ?? new BrightDataError('Bright Data no respondió');
}

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

/** Hash estable para un id corto cuando la fuente no publica uno. */
function shortId(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

const RELATIVE: Record<string, number> = {
  minuto: 60, minutos: 60, minute: 60, minutes: 60,
  hora: 3600, horas: 3600, hour: 3600, hours: 3600,
  dia: 86400, dias: 86400, day: 86400, days: 86400,
  semana: 604800, semanas: 604800, week: 604800, weeks: 604800,
  mes: 2592000, meses: 2592000, month: 2592000, months: 2592000,
};

/** Fecha relativa de Google («hace 2 días»). Sin frase reconocible queda desconocida, nunca inventada. */
export function postedAtFrom(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!text) return null;
  const absolute = Date.parse(value);
  if (Number.isFinite(absolute)) return new Date(absolute).toISOString();
  if (/\b(hoy|today|just posted|recien publicado)\b/.test(text)) return new Date(now).toISOString();
  if (/\b(ayer|yesterday)\b/.test(text)) return new Date(now - 86_400_000).toISOString();
  const match = text.match(/(\d+)\s*(?:[+]\s*)?(minuto|minutos|minute|minutes|hora|horas|hour|hours|dia|dias|day|days|semana|semanas|week|weeks|mes|meses|month|months)/);
  if (!match) return null;
  const unit = RELATIVE[match[2]];
  if (!unit) return null;
  return new Date(now - Number(match[1]) * unit * 1000).toISOString();
}

type RawJob = Record<string, unknown>;

const tagsText = (tags: unknown): string | null => {
  if (!Array.isArray(tags)) return null;
  const names = tags
    .map(tag => (tag && typeof tag === 'object' ? (tag as Record<string, unknown>).name : tag))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
  return names.length ? names.join(' · ') : null;
};

/** Un item de `jobs.items[]` → candidato de la app. Sin enlace o sin título no hay oferta verificable. */
export function jobToCandidate(item: unknown, now = Date.now()): Candidate | null {
  if (!item || typeof item !== 'object') return null;
  const job = item as RawJob;
  const title = clip(job.title, 200);
  const url = clip(job.link, 1000) ?? clip(job.url, 1000);
  if (!title || !url || !/^https?:\/\//i.test(url)) return null;
  const company = clip(job.company, 200) ?? clip(job.company_name, 200);
  const location = clip(job.location, 200);
  const source = clip(job.source, 80) ?? clip(job.via, 80);
  const description = [clip(job.description, 5900), tagsText(job.tags)].filter(Boolean).join(' · ') || null;
  return {
    external_id: `bd-${shortId(url)}`,
    title,
    company,
    location,
    url,
    salary: clip(job.salary, 200),
    description,
    posted_at: postedAtFrom(job.posted_at ?? job.date ?? job.posted, now),
    raw: { provider: 'brightdata', site: source ?? undefined },
  };
}

/** Forma documentada: `{ jobs: { items: [...] } }`. También acepta `jobs_results` si la zona cambia. */
export function jobsFromPayload(payload: unknown, now = Date.now()): Candidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as Record<string, unknown>;
  const jobs = body.jobs && typeof body.jobs === 'object' ? body.jobs as Record<string, unknown> : null;
  const items = Array.isArray(jobs?.items) ? jobs.items : Array.isArray(body.jobs_results) ? body.jobs_results : [];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const item of items) {
    const candidate = jobToCandidate(item, now);
    if (!candidate || seen.has(candidate.external_id)) continue;
    seen.add(candidate.external_id);
    out.push(candidate);
  }
  return out;
}

/** `maxAttempts: 1` desactiva el reintento: lo usa el cron, cuyo reloj compartido no admite un segundo intento. */
export type SerpJobsOptions = { query: string; gl?: string; hl?: string; timeoutMs?: number; fetchImpl?: FetchLike; now?: number; maxAttempts?: number };
export type SerpJobsResult = { candidates: Candidate[]; requests: number; costUsd: number; rawItems: number; hasJobsPanel: boolean };

/**
 * Una búsqueda de Google Jobs. Un fallo se lanza con su motivo (nunca se devuelve una lista vacía
 * como si fuera «no hay ofertas»). La llamada se cobra por petición correcta: el coste se devuelve
 * para que el llamador lo anote y lo sume al tope mensual.
 */
export async function serpJobs(config: BrightDataConfig, options: SerpJobsOptions): Promise<SerpJobsResult> {
  const { query, gl = 'es', hl = 'es', timeoutMs = 15_000, fetchImpl = fetch, now = Date.now(), maxAttempts = 2 } = options;
  if (!query.trim()) throw new BrightDataError('La búsqueda está vacía');
  const { text } = await postRequest(config, config.serpZone, googleJobsUrl(query, gl, hl), 'raw', fetchImpl, timeoutMs, maxAttempts);
  const body = unwrapBody(text);
  if (!body) {
    throw new BrightDataError('Bright Data devolvió HTML y no el JSON parseado: revisa que la zona sea de SERP API (no Web Unlocker) y que la URL lleve brd_json=1', 200, false);
  }
  if (typeof body.error === 'string' && body.error) throw new BrightDataError(`Bright Data: ${body.error.slice(0, 180)}`, 200, false);
  const jobs = body.jobs && typeof body.jobs === 'object' ? body.jobs as Record<string, unknown> : null;
  const rawItems = Array.isArray(jobs?.items) ? jobs.items.length : Array.isArray(body.jobs_results) ? body.jobs_results.length : 0;
  return {
    candidates: jobsFromPayload(body, now),
    requests: 1,
    costUsd: BRIGHTDATA_USD_PER_REQUEST,
    rawItems,
    // Sin panel de empleos en la respuesta no se dice «0 ofertas»: se dice que Google no lo mostró.
    hasJobsPanel: Boolean(jobs) || Array.isArray(body.jobs_results),
  };
}

export type UnlockResult = { html: string; requests: number; costUsd: number };

/** HTML de una página con anti-bot. Solo se usa donde hay un extractor probado (JSON-LD/RSS). */
export async function unlockHtml(config: BrightDataConfig, url: string, options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}): Promise<UnlockResult> {
  if (!config.unlockerZone) throw new BrightDataError('Falta la zona de Web Unlocker (API key:zona SERP:zona Unlocker)', 422, false);
  if (!/^https:\/\//i.test(url)) throw new BrightDataError('El Unlocker solo acepta enlaces HTTPS públicos', 422, false);
  const { timeoutMs = 20_000, fetchImpl = fetch } = options;
  const { text } = await postRequest(config, config.unlockerZone, url, 'raw', fetchImpl, timeoutMs);
  if (!text.trim()) throw new BrightDataError('El Unlocker devolvió una página vacía', 200, false);
  return { html: text, requests: 1, costUsd: BRIGHTDATA_USD_PER_REQUEST };
}
