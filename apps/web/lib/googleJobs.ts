import { getSecret } from './integrations';
import { ingest, pausedSourcesStrict, recordSpend, type Candidate } from './external';
import { callTimeout, MIN_STEP_MS, timeLeft } from './cronBudget';
import { loadMeter, type Meter } from './providerCaps';
import { PROVIDER_METERS, spendNote, type MeteredProvider } from './providerBudget';
import { BrightDataError, brightDataSource, parseBrightDataSecret, resolveBrightDataConfig, serpJobs, type BrightDataConfig } from './providers/brightdata';

// Google Jobs vía SerpApi: la única fuente de ofertas ya conectada que puede
// aportar closers de España sin una clave nueva. Google Jobs indexa InfoJobs,
// LinkedIn y portales, así que devuelve el inventario que los portales publican
// y el buscador ya tiene rastreado. Una búsqueda por dork y sin paginación: el
// `next_page_token` cuesta otra búsqueda y no se usa.
export const GOOGLE_JOBS_SOURCE = 'google-jobs';

// El vocabulario canónico del repo (ROLE_FAMILIES.closer), no inventado aquí:
// closer puro, high ticket y el título combinado setter/closer.
// Cada dork se busca en su país (`gl`) y en español (`hl`). El documento de prospección de WDC
// confirma que el mismo perfil se busca en España y en LatAm; las ofertas de LatAm son las que
// suelen pagar en dólares y antes no entraban en ninguna búsqueda.
export type Dork = { q: string; gl: 'es' | 'mx' | 'co' | 'ar'; hl: 'es' };
export const GOOGLE_JOBS_DORKS: readonly Dork[] = [
  // España
  { q: 'closer de ventas España', gl: 'es', hl: 'es' },
  { q: 'closer high ticket España', gl: 'es', hl: 'es' },
  { q: 'setter closer España', gl: 'es', hl: 'es' },
  { q: 'closer remoto España', gl: 'es', hl: 'es' },
  // LatAm · mercado en dólares
  { q: 'closer de ventas remoto', gl: 'mx', hl: 'es' },
  { q: 'closer high ticket', gl: 'co', hl: 'es' },
  { q: 'closer de ventas', gl: 'ar', hl: 'es' },
  // Ampliación: solo corre si se sube SERPAPI_JOBS_MAX_DORKS (cada búsqueda cuesta).
  { q: 'cerrador de ventas España', gl: 'es', hl: 'es' },
  { q: 'closer inbound', gl: 'mx', hl: 'es' },
  { q: 'ejecutivo de ventas remoto', gl: 'ar', hl: 'es' },
];

// Búsquedas incluidas en el presupuesto por defecto: 4 de España + 3 de LatAm = 7 × 0,025 USD.
// Subirlo se hace con SERPAPI_JOBS_MAX_DORKS (hasta el total de dorks de arriba); el panel muestra el coste.
export const DEFAULT_MAX_DORKS = 7;

// Precio de lista de SerpApi por búsqueda (Starter: 25 USD/1000). En el plan
// gratuito las búsquedas salen de las 250 mensuales; el coste se declara igual
// para que el operador vea lo que consume.
export const SEARCH_USD = 0.025;

export const maxDorks = (env: NodeJS.ProcessEnv = process.env) => {
  const raw = Number(env.SERPAPI_JOBS_MAX_DORKS ?? DEFAULT_MAX_DORKS);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), GOOGLE_JOBS_DORKS.length) : DEFAULT_MAX_DORKS;
};

// Con el presupuesto por defecto solo caben 7 de los 10 dorks. Enviar siempre los MISMOS 7 dos veces al día
// devuelve el mismo inventario y el catálogo deja de crecer aunque la recogida «vaya bien»: medido el
// 2026-11-19, 25 filas aceptadas por día y **una** nueva (el resto eran republicaciones ya guardadas).
// Se rota la ventana por día, sin gastar una búsqueda más, para que todo el vocabulario se ejecute en unos
// días. El reparto entre España y LatAm se mantiene (4+3): lo que rota es el término, no la cobertura.
export const DAY_MS = 86_400_000;
export function dorkWindow(now = Date.now(), limit = maxDorks()): Dork[] {
  const total = GOOGLE_JOBS_DORKS.length;
  const size = Math.min(Math.max(Math.floor(limit), 0), total);
  if (!size) return [];
  if (size === total) return [...GOOGLE_JOBS_DORKS];
  const spain = GOOGLE_JOBS_DORKS.filter(d => d.gl === 'es');
  const latam = GOOGLE_JOBS_DORKS.filter(d => d.gl !== 'es');
  const esCount = Math.min(spain.length, Math.max(1, Math.round((size * spain.length) / total)));
  const day = Math.floor(now / DAY_MS);
  const pick = (list: readonly Dork[], count: number) =>
    Array.from({ length: Math.min(count, list.length) }, (_, i) => list[(day + i) % list.length]);
  return [...pick(spain, esCount), ...pick(latam, size - esCount)];
}

// Fecha relativa tal como la publica Google («hace 2 días», «3 days ago»). Solo
// se usa cuando la fuente la dice; si no hay frase reconocible, la fecha queda
// desconocida en vez de inventarse.
const UNITS: Record<string, number> = {
  minuto: 60, minutos: 60, minute: 60, minutes: 60,
  hora: 3600, horas: 3600, hour: 3600, hours: 3600,
  dia: 86400, dias: 86400, day: 86400, days: 86400,
  semana: 604800, semanas: 604800, week: 604800, weeks: 604800,
  mes: 2592000, meses: 2592000, month: 2592000, months: 2592000,
};
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function postedAt(value: unknown, now = Date.now()): string | null {
  if (typeof value !== 'string') return null;
  const text = fold(value).trim();
  if (!text) return null;
  // Algunas respuestas traen la fecha ya resuelta (ISO o fecha corta) y no una
  // frase relativa: se acepta tal cual, sin reinterpretarla.
  const absolute = Date.parse(value);
  if (Number.isFinite(absolute)) return new Date(absolute).toISOString();
  if (/\b(just posted|recien publicado|hoy|today|ayer|yesterday)\b/.test(text)) {
    return new Date(now - (/ayer|yesterday/.test(text) ? 86400_000 : 0)).toISOString();
  }
  const match = text.match(/(\d+)\s*(?:\+\s*)?(minuto|minutos|minute|minutes|hora|horas|hour|hours|dia|dias|day|days|semana|semanas|week|weeks|mes|meses|month|months)/);
  if (!match) return null;
  const unit = UNITS[match[2]];
  if (!unit) return null;
  return new Date(now - Number(match[1]) * unit * 1000).toISOString();
}

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : null;
};

const clip = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

// Un `jobs_results` de google_jobs, tal como lo documenta SerpApi. El enlace de
// la oferta es `share_link`; `link` y `apply_options` son alternativas cuando la
// fuente no comparte ficha propia.
export function toCandidate(row: unknown): Candidate | null {
  if (!row || typeof row !== 'object') return null;
  const job = row as Record<string, unknown>;
  const detected = job.detected_extensions && typeof job.detected_extensions === 'object'
    ? job.detected_extensions as Record<string, unknown> : {};
  const apply = Array.isArray(job.apply_options) ? job.apply_options : [];
  const first = apply[0] && typeof apply[0] === 'object' ? apply[0] as Record<string, unknown> : {};
  // El enlace del portal va primero. `share_link` es la ficha dentro de Google
  // Jobs (google.com/search…): sirve de respaldo, pero no es el anuncio original
  // y la tarjeta de la alumna atribuiría la oferta a google.com.
  const url = httpUrl(first.link) ?? httpUrl(job.link) ?? httpUrl(job.share_link);
  const title = clip(job.title, 200);
  if (!url || !title) return null; // sin enlace o título no hay oferta verificable
  const external_id = clip(job.job_id, 200) ?? url;
  const salary = clip(detected.salary, 200);
  return {
    external_id,
    title,
    company: clip(job.company_name, 200) ?? clip(job.via, 200),
    location: clip(job.location, 200),
    url,
    salary,
    description: clip(job.description, 6000),
    posted_at: postedAt(detected.posted_at),
    raw: { provider: 'google', site: clip(job.via, 80) ?? undefined },
  };
}

export type GoogleJobsOutcome = {
  source: typeof GOOGLE_JOBS_SOURCE;
  ok: boolean;
  received?: number;
  accepted?: number;
  searches?: number;
  cost_usd?: number;
  error?: string;
  truncated?: boolean;
  /** Búsquedas y coste por proveedor (la cascada usa Bright Data antes que SerpApi). */
  by_provider?: Partial<Record<MeteredProvider, { searches: number; cost_usd: number }>>;
  /** Dorks que no se lanzaron porque el tope mensual del proveedor no daba para más. */
  skipped_budget?: number;
  /** Un gasto real no se pudo anotar: el marcador de inversión lo verá de menos. */
  spend_unrecorded?: boolean;
  /** Avisos que no hacen fallar la fuente: Bright Data falló y SerpApi cubrió la búsqueda; Google sin panel de empleos. */
  warnings?: string[];
  no_jobs_panel?: number;
};

type Fetcher = (dork: Dork, timeoutMs: number) => Promise<Candidate[]>;

export function serpapiFetcher(secret: string): Fetcher {
  return async (dork, timeoutMs) => {
    const base = process.env.SERPAPI_API_BASE ?? 'https://serpapi.com';
    const url = `${base}/search.json?engine=google_jobs&q=${encodeURIComponent(dork.q)}&gl=${dork.gl}&hl=${dork.hl}&api_key=${encodeURIComponent(secret)}`;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as Record<string, unknown>;
    const error = typeof data.error === 'string' ? data.error : '';
    if (error) {
      // Un dork sin resultados no es un fallo del proveedor: no oculta los demás.
      if (/returned any results|hasn't returned/i.test(error)) return [];
      throw new Error(`SerpApi: ${error}`);
    }
    const rows = Array.isArray(data.jobs_results) ? data.jobs_results : [];
    return rows.map(toCandidate).filter((c): c is Candidate => c !== null);
  };
}

/**
 * Google Jobs vía Bright Data (1/16 del precio de SerpApi). Un fallo —clave rechazada, zona que no es de SERP,
 * HTML en vez de JSON— se lanza para que la cascada pase a SerpApi; una respuesta sin panel de empleos para
 * ese dork cuenta como «sin ofertas» solo si Bright Data respondió JSON de verdad.
 */
export function brightDataFetcher(config: BrightDataConfig, onNoPanel?: () => void): Fetcher {
  return async (dork, timeoutMs) => {
    // Sin reintento: el cron tiene un reloj compartido y el fallback (SerpApi) ya es el segundo intento.
    const result = await serpJobs(config, { query: dork.q, gl: dork.gl, hl: dork.hl, timeoutMs, maxAttempts: 1 });
    if (!result.hasJobsPanel) onNoPanel?.();
    return result.candidates;
  };
}

// Recoge los dorks de closer/ES. Cascada por coste: Bright Data (0,0015 USD) si hay clave y tope, y SerpApi
// (0,025 USD) como respaldo de cada dork que Bright Data no resuelva. Antes de CADA búsqueda se comprueba el
// tope mensual del proveedor (`provider_budget`/entorno) contra el gasto ya anotado; sin gasto legible no se
// lanza nada. Lo gastado se anota con el formato único (`proveedor=… · coste_usd=…`) para que el marcador de
// inversión lo sume. Un fallo de un dork no tumba los demás; sin tiempo se corta y se declara. Nada se
// publica: los candidatos entran como borradores y siguen exigiendo la revisión del operador.
export async function collectGoogleJobs(
  via: string,
  deadline?: number,
  fetchFor: (secret: string) => Fetcher = serpapiFetcher,
  deps: { brightFetcher?: (config: BrightDataConfig, onNoPanel?: () => void) => Fetcher; meter?: Meter } = {},
): Promise<GoogleJobsOutcome> {
  try {
    const paused = await pausedSourcesStrict();
    if (!paused) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'No se pudo comprobar si la fuente está pausada; se reintenta en la próxima ejecución.' };
    if (paused.has(GOOGLE_JOBS_SOURCE)) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Fuente pausada' };
    const limit = maxDorks();
    if (limit === 0) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Recogida de Google Jobs desactivada (SERPAPI_JOBS_MAX_DORKS=0).' };
    const [serpSecret, brightSecret] = await Promise.all([getSecret('serpapi'), getSecret('brightdata')]);
    // La clave puede venir sola (sin zona): la zona SERP se descubre con la cuenta (llamada gratuita). Sin zona
    // SERP utilizable Bright Data no entra en la cascada y SerpApi cubre.
    let brightConfig: BrightDataConfig | null = null;
    if (brightSecret) {
      const parsed = parseBrightDataSecret(brightSecret);
      brightConfig = parsed?.serpZone ? parsed : (await resolveBrightDataConfig(brightSecret).catch(() => null))?.config ?? null;
      if (brightConfig && !brightConfig.serpZone) brightConfig = null;
    }
    if (!serpSecret && !brightConfig) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Sin clave guardada de SerpApi ni de Bright Data' };
    // 3,5 s: por debajo no da tiempo ni a una llamada útil; se corta y se dice. Va ANTES de leer el gasto del mes
    // (una lectura paginada) para no gastar el tramo en preparar una búsqueda que ya no cabe.
    if (timeLeft(deadline) < 3_500) {
      return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', searches: 0, cost_usd: 0, truncated: true };
    }
    const meter = deps.meter ?? await loadMeter();
    let noPanel = 0;
    const serpFetch = serpSecret ? fetchFor(serpSecret) : null;
    const brightFetch = brightConfig ? (deps.brightFetcher ?? brightDataFetcher)(brightConfig, () => { noPanel++; }) : null;
    const dorks = dorkWindow(Date.now(), limit);
    const all: Candidate[] = []; const errors: string[] = []; const warnings: string[] = []; let truncated = false;
    const used: Partial<Record<MeteredProvider, { searches: number; cost_usd: number }>> = {};
    const bill = (provider: MeteredProvider, sign = 1) => {
      const price = PROVIDER_METERS[provider].usdPerRequest * sign;
      meter.charge(provider, price);
      const row = used[provider] ?? { searches: 0, cost_usd: 0 };
      row.searches += sign; row.cost_usd = Math.round((row.cost_usd + price) * 1e6) / 1e6;
      used[provider] = row;
    };
    // La reserva se hace antes de lanzar (el tope vale también para búsquedas simultáneas); si el proveedor
    // rechaza la petición (HTTP de error, red) no la cobra y la reserva se devuelve. Una respuesta 200 que no
    // sirve (HTML en vez de JSON) sí se cobra: Bright Data factura las peticiones correctas.
    const refund = (provider: MeteredProvider, err: unknown) => {
      if (provider === 'brightdata' && err instanceof BrightDataError && err.status === 200) return;
      bill(provider, -1);
    };
    const blocked: string[] = [];
    // En paralelo: los dorks son independientes y en serie no cabían en el tramo del cron (la primera pasada se
    // cortó en el tercero). El proveedor de cada dork se decide ANTES de lanzar para que el tope valga también
    // para las búsquedas simultáneas; si Bright Data falla, ese dork pasa a SerpApi si el tope lo permite.
    const plan = dorks.map(dork => {
      if (brightFetch && meter.check('brightdata').ok) { bill('brightdata'); return { dork, first: 'brightdata' as const }; }
      if (serpFetch && meter.check('serpapi').ok) { bill('serpapi'); return { dork, first: 'serpapi' as const }; }
      blocked.push(meter.check(serpFetch ? 'serpapi' : 'brightdata').reason ?? 'tope mensual agotado');
      return { dork, first: null };
    });
    const skippedBudget = plan.filter(item => item.first === null).length;
    const settled = await Promise.allSettled(plan.map(async ({ dork, first }) => {
      if (first === null) return [] as Candidate[];
      if (first === 'brightdata') {
        try { return await brightFetch!(dork, callTimeout(12_000, deadline)); }
        catch (err) {
          refund('brightdata', err);
          // Sin SerpApi, sin tope para él o sin tiempo en el reloj compartido, el fallo se declara tal cual.
          if (!serpFetch || !meter.check('serpapi').ok || timeLeft(deadline) < MIN_STEP_MS) throw err;
          bill('serpapi');
          // Es un aviso, no un fallo de la fuente: SerpApi lo cubre. Solo cuenta como error si SerpApi también falla.
          warnings.push(`Bright Data (${dork.q}, ${dork.gl}): ${(err as Error).message} → SerpApi`);
          try { return await serpFetch(dork, callTimeout(12_000, deadline)); } catch (second) { refund('serpapi', second); throw second; }
        }
      }
      try { return await serpFetch!(dork, callTimeout(12_000, deadline)); } catch (err) { refund('serpapi', err); throw err; }
    }));
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') all.push(...result.value);
      else errors.push(`${plan[i].dork.q} (${plan[i].dork.gl}): ${(result.reason as Error)?.message ?? 'fallo'}`);
    });
    for (const key of Object.keys(used) as MeteredProvider[]) if (!used[key]?.searches) delete used[key];
    const searches = Object.values(used).reduce((n, row) => n + (row?.searches ?? 0), 0);
    const cost = Number(Object.values(used).reduce((sum, row) => sum + (row?.cost_usd ?? 0), 0).toFixed(4));
    if (deadline !== undefined && Date.now() >= deadline) truncated = true;
    // El gasto se anota por proveedor ANTES de decidir el resultado: una búsqueda se cobra aunque no traiga nada.
    let spendUnrecorded = false;
    for (const provider of ['brightdata', 'serpapi'] as const) {
      const row = used[provider];
      if (!row) continue;
      const source = provider === 'brightdata' ? brightDataSource('google') : GOOGLE_JOBS_SOURCE;
      const ok = await recordSpend(source, via, spendNote({ route: 'cascada', provider, requests: row.searches, costUsd: row.cost_usd, detail: 'google-jobs' }));
      if (!ok) spendUnrecorded = true;
    }
    const common = { searches, cost_usd: cost, by_provider: used, ...(warnings.length ? { warnings } : {}), ...(noPanel ? { no_jobs_panel: noPanel } : {}), ...(skippedBudget ? { skipped_budget: skippedBudget } : {}), ...(spendUnrecorded ? { spend_unrecorded: true } : {}), ...(truncated ? { truncated: true } : {}) };
    if (!all.length && skippedBudget === plan.length) {
      return { source: GOOGLE_JOBS_SOURCE, ok: false, error: `Sin presupuesto: ${blocked[0] ?? 'tope mensual agotado'}`, searches: 0, cost_usd: 0, skipped_budget: skippedBudget };
    }
    if (!all.length && errors.length) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: errors[0], ...common };
    if (!all.length && truncated) return { source: GOOGLE_JOBS_SOURCE, ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', ...common };
    // El mismo anuncio sale en varios dorks. Se queda uno por id y, si alguno trae el
    // enlace del portal, ese: el de la ficha de Google no debe pisarlo.
    const isGoogle = (u: string) => /^https?:\/\/(www\.)?google\./i.test(u);
    const byId = new Map<string, Candidate>();
    for (const c of all) {
      const prev = byId.get(c.external_id);
      if (!prev || (isGoogle(prev.url) && !isGoogle(c.url))) byId.set(c.external_id, c);
    }
    const unique = [...byId.values()];
    const notes = [
      errors.length ? `${errors.length} búsqueda(s) fallaron` : '',
      warnings.length ? `${warnings.length} búsqueda(s) pasaron de Bright Data a SerpApi` : '',
      noPanel ? `${noPanel} búsqueda(s) de Bright Data sin panel de empleos de Google (no es «0 ofertas» comprobado)` : '',
      truncated ? 'cortada por presupuesto de tiempo' : '',
      skippedBudget ? `${skippedBudget} búsqueda(s) sin lanzar por el tope mensual` : '',
    ].filter(Boolean).join(' · ') || undefined;
    const result = await ingest(GOOGLE_JOBS_SOURCE, via, unique, notes);
    return { source: GOOGLE_JOBS_SOURCE, ok: true, received: result.received, accepted: result.accepted, ...common };
  } catch (err) {
    return { source: GOOGLE_JOBS_SOURCE, ok: false, error: (err as Error).message };
  }
}
