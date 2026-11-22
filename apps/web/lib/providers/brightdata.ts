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
  if (!API_KEY.test(apiKey)) return null;
  if (serpZone && !ZONE.test(serpZone)) return null;
  if (unlockerZone && !ZONE.test(unlockerZone)) return null;
  return { apiKey, serpZone: serpZone || null, unlockerZone: unlockerZone || null };
}

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
/**
 * Variante de URL de Google para empleos. Medido en producción (2026-11-22): con `ibp=htl;jobs` Bright Data
 * devolvió JSON con solo `general`, `input` y `navigation` —su intérprete no lee esa vista—. Su documentación
 * describe `jobs` como «ofertas incrustadas en la página de búsqueda»: el recuadro de empleos de una búsqueda
 * normal. Orden: `search` (búsqueda normal con intención de empleo), `udm8` (pestaña Empleos actual) e `ibp`.
 */
export type JobsUrlVariant = 'search' | 'udm8' | 'ibp';
export const JOBS_URL_VARIANTS: readonly JobsUrlVariant[] = ['search', 'udm8', 'ibp'];
export const jobsUrlVariant = (env: NodeJS.ProcessEnv = process.env): JobsUrlVariant =>
  (JOBS_URL_VARIANTS as readonly string[]).includes(env.BRIGHTDATA_JOBS_URL ?? '') ? env.BRIGHTDATA_JOBS_URL as JobsUrlVariant : 'search';
const JOB_INTENT = /\b(empleo|empleos|trabajo|trabajos|oferta|ofertas|vacante|vacantes|jobs?)\b/i;

export function googleJobsUrl(query: string, gl = 'es', hl = 'es', variant: JobsUrlVariant = jobsUrlVariant()): string {
  const params = variant === 'search'
    ? new URLSearchParams({ q: JOB_INTENT.test(query) ? query : `${query} empleo`, brd_json: '1', hl, gl })
    : variant === 'udm8'
      ? new URLSearchParams({ q: query, udm: '8', brd_json: '1', hl, gl })
      : new URLSearchParams({ q: query, ibp: 'htl;jobs', brd_json: '1', hl, gl });
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
  // Un objeto en `body` es el resultado: se devuelve aunque no traiga `jobs` (antes solo se abría si lo traía y el
  // diagnóstico veía el sobre —status_code, headers, body— en vez de lo que de verdad respondió Google).
  if (body && typeof body === 'object' && !Array.isArray(body) && 'status_code' in (payload as Record<string, unknown>)) return body;
  if (body && typeof body === 'object') {
    const inner = body as Record<string, unknown>;
    if (inner.jobs !== undefined || inner.jobs_results !== undefined) return inner;
  }
  return payload;
}

/**
 * Describe sin copiar contenido qué devolvió Bright Data, para el mensaje de «Probar»: el código que Google dio dentro
 * del sobre, si el cuerpo es HTML, JSON (con sus campos) o está vacío, y su tamaño. Nunca incluye texto de la página.
 */
export function describeResponse(text: string): string {
  const parts: string[] = [];
  let value: unknown = null;
  try { value = JSON.parse(text); } catch { /* no es JSON */ }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'status_code' in (value as Record<string, unknown>)) {
    const envelope = value as Record<string, unknown>;
    parts.push(`Sobre de Bright Data con status_code ${String(envelope.status_code)}`);
    const body = envelope.body;
    if (typeof body === 'string') {
      try { value = JSON.parse(body); } catch { value = null; text = body; }
    } else value = body ?? null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) parts.push(`cuerpo JSON con campos: ${Object.keys(value as Record<string, unknown>).slice(0, 12).join(', ') || 'ninguno'}`);
  else if (Array.isArray(value)) parts.push(`cuerpo JSON en lista (${value.length} elementos)`);
  else if (!text.trim()) parts.push('cuerpo vacío');
  else if (/^\s*</.test(text)) parts.push(`cuerpo HTML de ${text.length} caracteres (Bright Data no lo interpretó como JSON)`);
  else parts.push(`cuerpo de texto de ${text.length} caracteres`);
  return parts.join(' · ');
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
 * Zonas ya resueltas, por clave. La consulta de zonas es gratis, pero el panel la hacía en CADA carga
 * (y en cada «Probar ruta»): con la clave guardada sola, eso es hasta 6 s de espera y depender de que
 * Bright Data responda para pintar el panel. Se guarda el resultado 10 minutos **en el proceso**; un
 * fallo NO se cachea, para no enseñar «sin zona» por un corte pasajero.
 */
const ZONES_TTL_MS = 10 * 60_000;
const zoneCache = new Map<string, { zones: BrightDataZone[]; at: number }>();

/** Clave de la caché: FNV-1a de la API key, para no retener la clave en claro en la memoria del proceso. */
function zoneCacheKey(apiKey: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < apiKey.length; i++) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${apiKey.length}:${hash.toString(16)}`;
}

/**
 * Guardar o borrar la clave de Bright Data tira la caché: una zona recién creada en la cuenta se ve en
 * la siguiente carga sin esperar al TTL. Las zonas escritas en el propio secreto no dependen de esto.
 */
export function clearBrightDataZoneCache(): void {
  zoneCache.clear();
}

export type BrightDataResolveOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Reloj de la caché (pruebas); por defecto `Date.now()`. */
  now?: number;
  /** `false` pregunta siempre a la cuenta: es lo que hace el botón «Probar». */
  useCache?: boolean;
};

/**
 * Completa las zonas que falten con la cuenta de Bright Data. Si el secreto ya trae las dos, no hay red;
 * si no, la cuenta se pregunta una vez cada `ZONES_TTL_MS` (caché en el proceso, `clearBrightDataZoneCache`
 * la tira al guardar la clave). Un fallo al leer las zonas **no invalida la clave** ni se cachea: se
 * devuelve el motivo y decide el llamador.
 */
export async function resolveBrightDataConfig(secret: string, options: BrightDataResolveOptions = {}): Promise<ResolvedBrightData> {
  const { fetchImpl, timeoutMs, now = Date.now(), useCache = true } = options;
  const parsed = parseBrightDataSecret(secret);
  if (!parsed) return { config: null, zones: null, error: 'Formato incorrecto: se esperaba la API key de Bright Data.' };
  if (parsed.serpZone && parsed.unlockerZone) return { config: parsed, zones: null, error: null };
  const withZones = (zones: BrightDataZone[]): BrightDataConfig => {
    const picked = pickBrightDataZones(zones);
    return {
      apiKey: parsed.apiKey,
      serpZone: parsed.serpZone ?? picked.serpZone,
      unlockerZone: parsed.unlockerZone ?? picked.unlockerZone,
    };
  };
  const key = zoneCacheKey(parsed.apiKey);
  const cached = useCache ? zoneCache.get(key) : undefined;
  if (cached && now - cached.at < ZONES_TTL_MS) return { config: withZones(cached.zones), zones: cached.zones, error: null };
  const listed = await listZones(parsed.apiKey, { fetchImpl, timeoutMs });
  if (listed.error) return { config: parsed, zones: null, error: listed.error };
  if (useCache) zoneCache.set(key, { zones: listed.zones, at: now });
  return { config: withZones(listed.zones), zones: listed.zones, error: null };
}

export type FetchLike = typeof fetch;

/**
 * La petición de prueba del panel: UNA búsqueda de Google Jobs, sin reintento (un reintento se cobraría).
 * Se usa con una configuración ya resuelta para no repetir la consulta de zonas. No se ejecuta al guardar.
 * Exige la zona en el tipo: el llamador ya la comprobó, así que no hay una rama de error inalcanzable.
 */
export function serpProbeRequest(config: BrightDataConfig & { serpZone: string }, fetchImpl: FetchLike = fetch, variant: JobsUrlVariant = jobsUrlVariant()): Promise<Response> {
  return fetchImpl(`${apiBase()}/request`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(40_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ zone: config.serpZone, url: googleJobsUrl('closer de ventas', 'es', 'es', variant), format: 'raw' }),
  });
}

async function postRequest(
  config: BrightDataConfig,
  zone: string,
  url: string,
  format: 'json' | 'raw',
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxAttempts = BRIGHTDATA_MAX_ATTEMPTS,
): Promise<{ text: string; attempts: number }> {
  let last: BrightDataError | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      if (attempt < maxAttempts) continue;
      throw last;
    }
    const text = await response.text().catch(() => '');
    if (response.ok) return { text, attempts: attempt };
    const retryable = response.status === 429 || response.status >= 500;
    last = new BrightDataError(`Bright Data respondió HTTP ${response.status}${text ? `: ${text.slice(0, 180)}` : ''}`, response.status, attempt);
    // Un 401/403 no mejora reintentando: la clave o la zona están mal.
    if (!retryable || attempt === maxAttempts) throw last;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw last ?? new BrightDataError('Bright Data no respondió', null, maxAttempts);
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

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const firstLink = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  for (const option of value) {
    const link = option && typeof option === 'object' ? str((option as RawJob).link) ?? str((option as RawJob).url) : str(option);
    if (link && /^https?:\/\//i.test(link)) return link;
  }
  return null;
};
const ext = (job: RawJob): RawJob => (job.detected_extensions && typeof job.detected_extensions === 'object' ? job.detected_extensions as RawJob : job.extensions && typeof job.extensions === 'object' && !Array.isArray(job.extensions) ? job.extensions as RawJob : {});

/**
 * Un item de empleo → candidato de la app. Acepta los nombres de campo de cualquier entrega (Full JSON de Bright
 * Data, Google Jobs de SerpApi y variantes): title/job_title/position, company/company_name/employer_name,
 * link/url/share_link/job_link/apply_link/apply_options[].link… Sin título o sin enlace http(s) no hay oferta
 * verificable y se descarta; ningún dato que falte se rellena.
 */
export function jobToCandidate(item: unknown, now = Date.now()): Candidate | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const job = item as RawJob;
  const title = clip(job.title ?? job.job_title ?? job.jobTitle ?? job.position ?? job.name, 200);
  const url = [job.link, job.url, job.share_link, job.job_link, job.apply_link, job.job_url, job.job_apply_link, job.applyUrl, job.jobUrl, job.linkedinUrl, job.job_google_link]
    .map(value => clip(value, 1000))
    .find(value => value && /^https?:\/\//i.test(value)) ?? clip(firstLink(job.apply_options) ?? firstLink(job.related_links), 1000);
  if (!title || !url || !/^https?:\/\//i.test(url)) return null;
  const extensions = ext(job);
  const company = clip(job.company ?? job.company_name ?? job.companyName ?? job.employer_name ?? job.employer ?? job.organization, 200);
  const cityCountry = [str(job.job_city), str(job.job_country)].filter(Boolean).join(', ') || null;
  const location = clip(job.location ?? job.job_location ?? cityCountry, 200);
  const source = clip(job.source ?? job.via ?? job.publisher ?? job.job_publisher, 80);
  const description = [clip(job.description ?? job.snippet ?? job.job_description ?? job.descriptionText, 5900), tagsText(job.tags)].filter(Boolean).join(' · ') || null;
  return {
    external_id: `bd-${shortId(url)}`,
    title,
    company,
    location,
    url,
    salary: clip(job.salary ?? extensions.salary, 200),
    description,
    posted_at: postedAtFrom(job.posted_at ?? job.date ?? job.posted ?? job.job_posted_at ?? job.postedTimeAgo ?? extensions.posted_at, now),
    raw: { provider: 'brightdata', site: source ?? undefined },
  };
}

const JOB_KEY = /job/i;
const looksLikeJob = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const job = value as RawJob;
  const titled = Boolean(str(job.title) ?? str(job.job_title) ?? str(job.jobTitle) ?? str(job.position));
  const company = Boolean(str(job.company) ?? str(job.company_name) ?? str(job.companyName) ?? str(job.employer_name) ?? str(job.employer) ?? str(job.organization));
  return titled && company;
};
const parseMaybeJson = (value: string): unknown => {
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
};

/**
 * Busca el listado de empleos en CUALQUIER forma JSON que entregue el proveedor: directo (`jobs.items`, `jobs`,
 * `jobs_results`), dentro de un sobre `{status_code, headers, body}` con el cuerpo como objeto o como texto JSON, o
 * anidado a cualquier profundidad. Una lista cuenta como empleos si cuelga de una clave con «job» o si sus
 * elementos tienen título y empresa: así los resultados orgánicos de Google (título y enlace, sin empresa) no se
 * confunden con ofertas. `panel` dice si apareció un bloque de empleos aunque viniera vacío.
 */
export function extractJobItems(rawPayload: unknown): { items: unknown[]; panel: boolean } {
  const found: unknown[] = [];
  let panel = false;
  const seen = new Set<unknown>();
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.length < 2 || depth > 6) return;
      const parsed = parseMaybeJson(value);
      if (parsed !== undefined) visit(parsed, key, depth + 1);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const jobLike = value.filter(looksLikeJob);
      if (JOB_KEY.test(key)) { panel = true; found.push(...value.filter(item => item && typeof item === 'object' && !Array.isArray(item))); return; }
      if (jobLike.length && jobLike.length >= Math.ceil(value.length / 2)) { panel = true; found.push(...jobLike); return; }
      value.forEach(item => visit(item, key, depth + 1));
      return;
    }
    const record = value as RawJob;
    for (const [childKey, child] of Object.entries(record)) {
      if (childKey === 'html' || childKey === 'headers') continue;
      if (JOB_KEY.test(childKey) && child && typeof child === 'object' && !Array.isArray(child)) panel = true;
      visit(child, JOB_KEY.test(key) && childKey === 'items' ? key : childKey, depth + 1);
    }
  };
  visit(rawPayload, '', 0);
  return { items: found, panel };
}

/** Candidatos de una respuesta en cualquier forma (ver `extractJobItems`), sin duplicados por enlace. */
export function jobsFromPayload(rawPayload: unknown, now = Date.now()): Candidate[] {
  const { items } = extractJobItems(rawPayload);
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
export type SerpJobsResult = { candidates: Candidate[]; requests: number; costUsd: number; rawItems: number; /** La respuesta traía el panel de empleos de Google (aunque estuviera vacío); sin él no es «0 ofertas» comprobado. */ hasJobsPanel: boolean };

/**
 * Una búsqueda de Google Jobs. Un fallo se lanza con su motivo (nunca se devuelve una lista vacía
 * como si fuera «no hay ofertas»). La llamada se cobra por petición correcta: el coste se devuelve
 * para que el llamador lo anote y lo sume al tope mensual.
 */
export async function serpJobs(config: BrightDataConfig, options: SerpJobsOptions): Promise<SerpJobsResult> {
  const { query, gl = 'es', hl = 'es', timeoutMs = 15_000, fetchImpl = fetch, now = Date.now(), maxAttempts = BRIGHTDATA_MAX_ATTEMPTS } = options;
  if (!query.trim()) throw new BrightDataError('La búsqueda está vacía');
  if (!config.serpZone) throw new BrightDataError('Falta la zona SERP de Bright Data (API key:zona SERP)', 422);
  const { text, attempts } = await postRequest(config, config.serpZone, googleJobsUrl(query, gl, hl), 'raw', fetchImpl, timeoutMs, maxAttempts);
  return { ...parseSerpJobs(text, attempts, now), requests: attempts, costUsd: attempts * BRIGHTDATA_USD_PER_REQUEST };
}

/**
 * Lee una respuesta de Google Jobs de Bright Data (síncrona o recogida en modo asíncrono). Un cuerpo que no es
 * JSON o un `error` de Bright Data se lanzan: no es «0 ofertas».
 */
export function parseSerpJobs(text: string, attempts = 1, now = Date.now()): { candidates: Candidate[]; rawItems: number; hasJobsPanel: boolean } {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BrightDataError(`Bright Data devolvió algo que no es JSON (${describeResponse(text)}); revisa la zona SERP`, 200, attempts);
  }
  const unwrapped = unwrapPayload(payload);
  const body = unwrapped && typeof unwrapped === 'object' ? unwrapped as Record<string, unknown> : {};
  if (typeof body.error === 'string' && body.error) throw new BrightDataError(`Bright Data: ${body.error.slice(0, 180)}`, 200, attempts);
  const { items, panel } = extractJobItems(payload);
  return { candidates: jobsFromPayload(payload, now), rawItems: items.length, hasJobsPanel: panel };
}

/**
 * MODO ASÍNCRONO (hay que activarlo en la zona: Advanced settings → Asynchronous requests). Encargar es
 * `POST /request?async=1` con el mismo cuerpo que la llamada normal; Bright Data responde enseguida con el
 * identificador en la cabecera `x-response-id` y se cobra aquí (al encargar). Recoger con
 * `GET /serp/get_result?response_id=…` no se cobra: 202 = aún procesando, 200 = resultado. El resultado se guarda
 * 48 h, así que lo que no esté listo se recoge en la siguiente pasada sin pagar otra vez.
 */
export async function serpSubmitAsync(config: BrightDataConfig, url: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<{ id: string } | { text: string }> {
  const { fetchImpl = fetch, timeoutMs = 15_000 } = options;
  if (!config.serpZone) throw new BrightDataError('Falta la zona SERP de Bright Data (API key:zona SERP)', 422);
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/request?async=1`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ zone: config.serpZone, url, format: 'raw' }),
    });
  } catch (err) {
    throw new BrightDataError(`No se pudo contactar con Bright Data: ${(err as Error).message}`, null, 1);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new BrightDataError(`Bright Data rechazó la búsqueda asíncrona (HTTP ${response.status})${text ? `: ${text.slice(0, 160)}` : ''}`, response.status, 1);
  let id = response.headers.get('x-response-id');
  if (!id) {
    try { const body = JSON.parse(text) as Record<string, unknown>; id = typeof body.response_id === 'string' ? body.response_id : null; } catch { /* sin JSON */ }
  }
  if (id && /^[A-Za-z0-9_-]{4,128}$/.test(id)) return { id };
  // Sin identificador pero con cuerpo: la zona no está en modo asíncrono y Bright Data respondió en síncrono (y lo
  // cobró). Se devuelve esa respuesta para leerla en vez de tirarla. Sin cuerpo útil se dice qué activar.
  if (text.trim()) return { text };
  throw new BrightDataError('Bright Data no devolvió response_id ni resultado: activa «Asynchronous requests» en la zona SERP', response.status, 1);
}

/** Modo asíncrono de Bright Data: activo salvo `BRIGHTDATA_ASYNC=0` (la zona debe tenerlo activado). */
export const brightAsyncEnabled = (env: NodeJS.ProcessEnv = process.env) => env.BRIGHTDATA_ASYNC !== '0';

export type AsyncCollect = { status: 'pending' } | { status: 'ready'; text: string } | { status: 'gone'; detail: string } | { status: 'error'; detail: string };

/** Recoge un encargo asíncrono (gratis). Nunca lanza: devuelve el estado para que el llamador decida. */
export async function serpCollectAsync(apiKey: string, responseId: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<AsyncCollect> {
  const { fetchImpl = fetch, timeoutMs = 15_000 } = options;
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase()}/serp/get_result?response_id=${encodeURIComponent(responseId)}`, {
      method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { status: 'error', detail: `No se pudo contactar con Bright Data: ${(err as Error).message}` };
  }
  const text = await response.text().catch(() => '');
  if (response.status === 202 || /request is pending/i.test(text.slice(0, 80))) return { status: 'pending' };
  if (response.ok) return { status: 'ready', text };
  if (response.status === 404 || /result not found/i.test(text.slice(0, 80))) return { status: 'gone', detail: 'Bright Data ya no tiene el resultado (caduca a las 48 h)' };
  return { status: 'error', detail: `Bright Data respondió HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}` };
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
