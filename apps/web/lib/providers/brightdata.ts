import type { Candidate } from '../external';

// Bright Data · SERP API y Web Unlocker.
//
// Contrato verificado en su documentación (2026-11-21): `POST https://api.brightdata.com/request`
// con `Authorization: Bearer <API key>` y `{zone, url, format}`. Para Google Jobs se pide la URL de
// Google con `ibp=htl%3Bjobs`; su JSON parseado trae `jobs.items[]` con título, empresa, ubicación,
// fuente, descripción, enlace y etiquetas. Precio de lista: 1,50 USD por 1.000 peticiones correctas
// (0,0015 USD cada una) y 5.000 créditos gratis al mes COMPARTIDOS entre sus productos.
//
// Lo que este módulo NO hace: inventar campos que la respuesta no trae. Sin enlace o sin título, el
// anuncio se descarta y se declara el descarte; empresa, ubicación y salario quedan como «no indicado»
// si no vienen. No hay ninguna llamada real en las pruebas: se usa un `fetch` simulado y un fixture
// con la forma documentada, y el panel lo marca «documentada · sin probar» hasta la primera ejecución
// con clave de verdad.

export const BRIGHTDATA_USD_PER_REQUEST = 0.0015;

/** Intentos por llamada. El tope reserva este número antes de lanzar: un reintento no lo desborda. */
export const BRIGHTDATA_MAX_ATTEMPTS = 2;

export type BrightDataConfig = {
  apiKey: string;
  /** Zona SERP API. Puede faltar: se descubre con la cuenta (gratis) antes de usarla. */
  serpZone: string | null;
  /** Zona del Web Unlocker; opcional porque solo hace falta para leer HTML de portales. */
  unlockerZone: string | null;
};

export type BrightDataZone = { name: string; type: string | null };

// La API key de Bright Data es un token hexadecimal largo (64 caracteres en su documentación);
// se aceptan también `.`, `_`, `~` y `-` para no rechazar una clave correcta por su alfabeto.
const API_KEY = /^[A-Za-z0-9._~-]{8,300}$/;
const ZONE = /^[A-Za-z0-9_.-]{2,80}$/;

/**
 * La clave se guarda como `API key`, `API key:zona SERP` o `API key:zona SERP:zona Unlocker`.
 * La API key sola es el formato que da Bright Data (Cuenta → API keys): las zonas se descubren con
 * `GET /zone/get_active_zones`, que es gratis. Antes se exigían dos partes, así que una clave correcta
 * pegada tal cual se rechazaba como «formato incorrecto» sin haberla comprobado nunca.
 */
export function parseBrightDataSecret(secret: string): BrightDataConfig | null {
  const parts = secret.trim().split(':').map(part => part.trim());
  if (parts.length > 3) return null;
  const [apiKey, serpZone, unlockerZone] = parts;
  if (!API_KEY.test(apiKey ?? '')) return null;
  if (serpZone && !ZONE.test(serpZone)) return null;
  if (unlockerZone && !ZONE.test(unlockerZone)) return null;
  return { apiKey, serpZone: serpZone || null, unlockerZone: unlockerZone || null };
}

/** Nunca se imprime la clave: solo los últimos 4 caracteres, como el resto de proveedores. */
export const brightDataLast4 = (secret: string) => secret.trim().slice(-4);

export class BrightDataError extends Error {
  readonly status: number | null;
  /** Intentos hechos: si hubo error de red, el primero pudo facturarse aunque no llegara respuesta. */
  readonly attempts: number;
  constructor(message: string, status: number | null = null, attempts = 0) {
    super(message);
    this.name = 'BrightDataError';
    this.status = status;
    this.attempts = attempts;
  }
}

export const apiBase = () => process.env.BRIGHTDATA_API_BASE ?? 'https://api.brightdata.com';

/** Atribución por fuente: `brightdata-google` o `brightdata-<portal>` (p. ej. `brightdata-infojobs`). */
export const brightDataSource = (code: string) => `brightdata-${code}`;

/**
 * URL de Google Jobs: `ibp=htl;jobs` activa el panel de vacantes y `brd_json=1` pide a Bright Data el JSON
 * ya interpretado (sin él la respuesta puede ser HTML o un envoltorio y el anuncio no se puede leer).
 */
export function googleJobsUrl(query: string, gl = 'es', hl = 'es'): string {
  const params = new URLSearchParams({ q: query, ibp: 'htl;jobs', brd_json: '1', hl, gl });
  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * `POST /request` puede devolver el resultado dentro de `{status_code, headers, body}` (el cuerpo como texto
 * JSON). Se desenvuelve sin inventar nada; si no hay envoltorio se devuelve el mismo objeto.
 */
export function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const body = (payload as Record<string, unknown>).body;
  if (typeof body === 'string' && body.trim()) {
    try { return JSON.parse(body); } catch { return payload; }
  }
  if (body && typeof body === 'object') {
    const inner = body as Record<string, unknown>;
    if (inner.jobs !== undefined || inner.jobs_results !== undefined) return inner;
  }
  return payload;
}

/** Zonas activas de la cuenta: `[{name, type}]` (la documentación también admite `{zones: [...]}`). */
export function zonesFromPayload(payload: unknown): BrightDataZone[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).zones)
      ? (payload as Record<string, unknown>).zones as unknown[]
      : [];
  return list
    .map(zone => {
      if (!zone || typeof zone !== 'object') return null;
      const record = zone as Record<string, unknown>;
      const name = clip(record.name, 80);
      const type = clip(record.type, 40);
      return name ? { name, type: type ? type.toLowerCase() : null } : null;
    })
    .filter((zone): zone is BrightDataZone => zone !== null);
}

/** Primera zona SERP y primera de Web Unlocker de la cuenta. `null` si esa cuenta no tiene ninguna. */
export function pickBrightDataZones(zones: BrightDataZone[]): { serpZone: string | null; unlockerZone: string | null } {
  const byType = (...types: string[]) => zones.find(zone => zone.type && types.includes(zone.type))?.name ?? null;
  return {
    serpZone: byType('serp', 'serp_api', 'serp-api'),
    unlockerZone: byType('unblocker', 'web_unlocker', 'web-unlocker'),
  };
}

export type ZonesResult = { zones: BrightDataZone[]; status: number | null; error: string | null };

/**
 * Zonas activas de la cuenta con la API key. Es gratis (no consume créditos de scraping) y por eso sirve
 * para validar la clave y las zonas ANTES de lanzar una petición de pago.
 */
export async function listZones(apiKey: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<ZonesResult> {
  const { fetchImpl = fetch, timeoutMs = 8_000 } = options;
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/zone/get_active_zones`, {
      method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { zones: [], status: null, error: `No se pudo contactar con Bright Data: ${(err as Error).message}` };
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) return { zones: [], status: response.status, error: `Bright Data respondió HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}` };
  let payload: unknown = null;
  try { payload = JSON.parse(text); } catch { /* respuesta sin JSON: se declara «sin zonas legibles» */ }
  return { zones: zonesFromPayload(payload), status: response.status, error: null };
}

export type ResolvedBrightData = {
  /** `null` si el texto guardado no es una clave utilizable. */
  config: BrightDataConfig | null;
  /** `null` si no se pudo leer la cuenta (no se confunde con «sin zonas»). */
  zones: BrightDataZone[] | null;
  /** Motivo por el que no se pudieron completar las zonas, con la clave ya validada. */
  error: string | null;
};

/**
 * Completa las zonas que falten con la cuenta de Bright Data. Si el secreto ya trae las dos, no hay red.
 * Un fallo al leer las zonas **no invalida la clave**: se devuelve el motivo y decide el llamador.
 */
export async function resolveBrightDataConfig(secret: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<ResolvedBrightData> {
  const parsed = parseBrightDataSecret(secret);
  if (!parsed) return { config: null, zones: null, error: 'Formato incorrecto: se esperaba la API key de Bright Data.' };
  if (parsed.serpZone && parsed.unlockerZone) return { config: parsed, zones: null, error: null };
  const listed = await listZones(parsed.apiKey, options);
  if (listed.error) return { config: parsed, zones: null, error: listed.error };
  const picked = pickBrightDataZones(listed.zones);
  return {
    config: {
      apiKey: parsed.apiKey,
      serpZone: parsed.serpZone ?? picked.serpZone,
      unlockerZone: parsed.unlockerZone ?? picked.unlockerZone,
    },
    zones: listed.zones,
    error: null,
  };
}

type FetchLike = typeof fetch;

/**
 * La petición de prueba del panel: UNA búsqueda de Google Jobs, sin reintento (un reintento se cobraría).
 * Se usa con una configuración ya resuelta para no repetir la consulta de zonas. No se ejecuta al guardar.
 */
export function serpProbeRequest(config: BrightDataConfig, fetchImpl: FetchLike = fetch): Promise<Response> {
  if (!config.serpZone) return Promise.reject(new BrightDataError('Falta la zona SERP de Bright Data (API key:zona SERP)', 422));
  return fetchImpl(`${apiBase()}/request`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ zone: config.serpZone, url: googleJobsUrl('closer de ventas'), format: 'json' }),
  });
}

async function postRequest(
  config: BrightDataConfig,
  zone: string,
  url: string,
  format: 'json' | 'raw',
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ text: string; attempts: number }> {
  let last: BrightDataError | null = null;
  for (let attempt = 1; attempt <= BRIGHTDATA_MAX_ATTEMPTS; attempt++) {
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
      last = new BrightDataError(`No se pudo contactar con Bright Data: ${(err as Error).message}`, null, attempt);
      if (attempt < BRIGHTDATA_MAX_ATTEMPTS) continue;
      throw last;
    }
    const text = await response.text().catch(() => '');
    if (response.ok) return { text, attempts: attempt };
    const retryable = response.status === 429 || response.status >= 500;
    last = new BrightDataError(`Bright Data respondió HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`, response.status, attempt);
    // Un 401/403 no mejora reintentando: la clave o la zona están mal.
    if (!retryable || attempt === BRIGHTDATA_MAX_ATTEMPTS) throw last;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw last ?? new BrightDataError('Bright Data no respondió', null, BRIGHTDATA_MAX_ATTEMPTS);
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

/** Forma documentada: `{ jobs: { items: [...] } }`. También acepta `jobs_results` y el envoltorio `{body}`. */
export function jobsFromPayload(rawPayload: unknown, now = Date.now()): Candidate[] {
  const payload = unwrapPayload(rawPayload);
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

export type SerpJobsOptions = { query: string; gl?: string; hl?: string; timeoutMs?: number; fetchImpl?: FetchLike; now?: number };
export type SerpJobsResult = { candidates: Candidate[]; requests: number; costUsd: number; rawItems: number };

/**
 * Una búsqueda de Google Jobs. Un fallo se lanza con su motivo (nunca se devuelve una lista vacía
 * como si fuera «no hay ofertas»). La llamada se cobra por petición correcta: el coste se devuelve
 * para que el llamador lo anote y lo sume al tope mensual.
 */
export async function serpJobs(config: BrightDataConfig, options: SerpJobsOptions): Promise<SerpJobsResult> {
  const { query, gl = 'es', hl = 'es', timeoutMs = 15_000, fetchImpl = fetch, now = Date.now() } = options;
  if (!query.trim()) throw new BrightDataError('La búsqueda está vacía');
  if (!config.serpZone) throw new BrightDataError('Falta la zona SERP de Bright Data (API key:zona SERP)', 422);
  const { text, attempts } = await postRequest(config, config.serpZone, googleJobsUrl(query, gl, hl), 'json', fetchImpl, timeoutMs);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BrightDataError('Bright Data devolvió una respuesta que no es JSON; revisa la zona SERP', 200, attempts);
  }
  const unwrapped = unwrapPayload(payload);
  const body = unwrapped && typeof unwrapped === 'object' ? unwrapped as Record<string, unknown> : {};
  if (typeof body.error === 'string' && body.error) throw new BrightDataError(`Bright Data: ${body.error.slice(0, 180)}`, 200, attempts);
  const jobs = body.jobs && typeof body.jobs === 'object' ? body.jobs as Record<string, unknown> : null;
  const rawItems = Array.isArray(jobs?.items) ? jobs.items.length : Array.isArray(body.jobs_results) ? body.jobs_results.length : 0;
  return {
    candidates: jobsFromPayload(payload, now),
    // Se cobra por intento: un reintento pudo facturarse y el tope debe verlo igual que el proveedor.
    requests: attempts,
    costUsd: attempts * BRIGHTDATA_USD_PER_REQUEST,
    rawItems,
  };
}

export type UnlockResult = { html: string; requests: number; costUsd: number };

/** HTML de una página con anti-bot. Solo se usa donde hay un extractor probado (JSON-LD/RSS). */
export async function unlockHtml(config: BrightDataConfig, url: string, options: { timeoutMs?: number; fetchImpl?: FetchLike } = {}): Promise<UnlockResult> {
  if (!config.unlockerZone) throw new BrightDataError('Falta la zona de Web Unlocker (API key:zona SERP:zona Unlocker)', 422);
  if (!/^https:\/\//i.test(url)) throw new BrightDataError('El Unlocker solo acepta enlaces HTTPS públicos', 422);
  const { timeoutMs = 20_000, fetchImpl = fetch } = options;
  const { text, attempts } = await postRequest(config, config.unlockerZone, url, 'raw', fetchImpl, timeoutMs);
  if (!text.trim()) throw new BrightDataError('El Unlocker devolvió una página vacía', 200, attempts);
  return { html: text, requests: attempts, costUsd: attempts * BRIGHTDATA_USD_PER_REQUEST };
}
