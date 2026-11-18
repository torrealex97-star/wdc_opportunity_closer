import { getSecret, type Provider } from './integrations';
import { ingest, pausedSourcesStrict, type Candidate } from './external';
import { callTimeout, timeLeft, MIN_STEP_MS } from './cronBudget';
import { enrich } from './offerScore';

// Recolectores de APIs oficiales con clave (InfoJobs, Adzuna, Jooble). Permiso explícito del proveedor:
// es la vía de menor riesgo. Volumen bajo: pocas consultas por pasada y una página cada una, salvo InfoJobs
// (ver abajo), que pagina, filtra y pide ficha solo de las ofertas que ya puntúan alto.
export const QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial', 'ejecutivo comercial', 'cold caller'];
export const API_PROVIDERS = ['infojobs', 'adzuna', 'jooble'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

const json = async (response: Response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); };
const pairOf = (k: string) => { const i = k.indexOf(':'); if (i <= 0) throw new Error('Formato de clave incorrecto'); return [k.slice(0, i), k.slice(i + 1)] as const; };
const money = (min?: number | null, max?: number | null, cur = '€') => (min && max ? `${Math.round(min)}–${Math.round(max)} ${cur}` : min || max ? `${Math.round((min ?? max) as number)} ${cur}` : null);
const intInRange = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

// ── InfoJobs v9 (documentación oficial leída el 2026-11-18) ───────────────────────────────────────
// El listado admite `province` (repetible), `category`, `sinceDate`, `teleworking` y `page`, y la ficha
// `GET /api/9/offer/{id}` trae la descripción y el salario con su periodo. Antes se pedía UNA página de 50
// sin filtros y sin ficha: el anuncio entraba sin cuerpo, y sin cuerpo la vista no puede juzgar el idioma.
export const INFOJOBS_PAGE_SIZE = 50; // la propia documentación recomienda no pasar de 50
// Dos páginas por término (100) porque cada petición pesa en el cron; el reloj corta antes si no llega.
export const INFOJOBS_PAGES = 2;
// _24_HOURS | _7_DAYS | _15_DAYS | ANY. Quince días es la ventana con la que ya trabaja el catálogo.
export const INFOJOBS_SINCE = '_15_DAYS';
// Fichas por término, de mayor a menor puntuación: cada ficha es una petición más.
export const INFOJOBS_DETAIL_TOP = 10;
// El mismo corte que la aprobación automática (autoReview.MIN_SCORE): por debajo ni se pide la ficha.
export const INFOJOBS_DETAIL_MIN_SCORE = 55;
// Las 52 provincias del diccionario oficial (`dictionary/province?parent=17`), no una lista inventada.
// Enviarlas deja el alcance en España sin perder inventario; `INFOJOBS_PROVINCES` acota (vacío = sin filtro).
export const INFOJOBS_PROVINCES = [
  'a-coruna', 'alava', 'albacete', 'alicante-alacant', 'almeria', 'asturias', 'avila', 'badajoz', 'barcelona', 'burgos',
  'caceres', 'cadiz', 'cantabria', 'castellon-castello', 'ceuta', 'ciudad-real', 'cordoba', 'cuenca', 'girona', 'granada',
  'guadalajara', 'guipuzcoa', 'huelva', 'huesca', 'illes-balears', 'jaen', 'la-rioja', 'las-palmas', 'leon', 'lleida',
  'lugo', 'madrid', 'malaga', 'melilla', 'murcia', 'navarra', 'ourense', 'palencia', 'pontevedra', 'salamanca',
  'santa-cruz-de-tenerife', 'segovia', 'sevilla', 'soria', 'tarragona', 'teruel', 'toledo', 'valencia-valencia', 'valladolid',
  'vizcaya', 'zamora', 'zaragoza',
];
// El perfil que se busca es comercial: la categoría de ventas de InfoJobs. Vacío = sin filtro de categoría.
export const INFOJOBS_CATEGORIES = ['comercial-ventas'];
// Teletrabajo posible o exclusivo (las claves del diccionario `teleworking`); presencial queda fuera por decisión
// declarada, no medida, y se puede abrir con `INFOJOBS_TELEWORKING=`.
export const INFOJOBS_TELEWORKING = ['teletrabajo-posible', 'solo-teletrabajo'];

type InfojobsEnv = Record<string, string | undefined>;
type InfojobsOffer = Record<string, unknown>;
const infoString = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
};
const infoField = (v: unknown, key: string): unknown => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined);
// Una lista de filtros: sin la variable se usa la declarada; con ella, lo que diga (vacía = sin filtro).
const envList = (name: string, fallback: readonly string[], env: InfojobsEnv): string[] => {
  const raw = env[name];
  if (raw === undefined) return [...fallback];
  return raw.split(',').map(v => v.trim()).filter(Boolean);
};
/** Parámetros del listado, en un sitio y probables sin red. */
export function infojobsListParams(query: string, page: number, env: InfojobsEnv = process.env): URLSearchParams {
  const params = new URLSearchParams({
    q: query, order: 'updated-desc', page: String(page), maxResults: String(INFOJOBS_PAGE_SIZE),
    sinceDate: env.INFOJOBS_SINCE?.trim() || INFOJOBS_SINCE,
  });
  for (const province of envList('INFOJOBS_PROVINCES', INFOJOBS_PROVINCES, env)) params.append('province', province);
  for (const category of envList('INFOJOBS_CATEGORIES', INFOJOBS_CATEGORIES, env)) params.append('category', category);
  for (const teleworking of envList('INFOJOBS_TELEWORKING', INFOJOBS_TELEWORKING, env)) params.append('teleworking', teleworking);
  return params;
}
// Un importe: el listado manda `value` y la ficha `amount`/`amountValue` («36.000 €»).
const infoEuro = (v: unknown): string | null => {
  const shown = infoString(infoField(v, 'amountValue')) ?? infoString(infoField(v, 'value'));
  if (shown) return shown.includes('€') ? shown : `${shown} €`;
  const amount = Number(infoField(v, 'amount'));
  return Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString('es-ES')} €` : null;
};
const infoPeriod = (v: unknown): string | null => {
  const text = infoString(infoField(v, 'periodValue')) ?? infoString(infoField(v, 'value'));
  return text ? text.toLowerCase() : null;
};
/** «30.000–36.000 € bruto/año»; con un solo extremo, ese. Sin importe, null (nunca un cero). */
export function infojobsSalary(min: unknown, max: unknown, period: unknown): string | null {
  const a = infoEuro(min), b = infoEuro(max);
  if (!a && !b) return null;
  const range = a && b && a !== b ? `${a.replace(' €', '')}–${b}` : (a ?? b) as string;
  const kind = infoPeriod(period) ?? infoPeriod(min) ?? infoPeriod(max);
  return `${range}${kind ? ` ${kind}` : ''}`.slice(0, 200);
}
/** ¿Da la oferta teletrabajo? `null` = la API no lo dice (un hueco, no un «no»). */
export function infojobsRemote(offer: InfojobsOffer): boolean | null {
  const value = (infoString(infoField(offer.teleworking, 'value')) ?? infoString(infoField(offer.teleworking, 'key')))?.toLowerCase();
  if (!value) return null;
  if (value.includes('presencial')) return false;
  if (value.includes('teletrabajo')) return true;
  return null;
}
/** Oferta del listado, enriquecida con la ficha si la hay (la ficha manda en los campos que repite). */
export function infojobsCandidate(offer: InfojobsOffer, detail?: InfojobsOffer | null): Candidate {
  const o = detail ? { ...offer, ...detail } : offer;
  return {
    external_id: String(infoString(o.id) ?? ''), title: infoString(o.title) ?? '', company: infoString(infoField(o.author, 'name')),
    location: [infoString(o.city), infoString(infoField(o.province, 'value'))].filter(Boolean).join(', ') || null,
    url: infoString(o.link) ?? '',
    salary: infojobsSalary(o.salaryMin, o.salaryMax, o.salaryPeriod) ?? infoString(o.salaryDescription),
    posted_at: infoString(o.published) ?? infoString(o.updated) ?? null,
    description: infoString(o.description) ?? infoString(o.minRequirements),
    raw: { provider: 'infojobs', category: infoString(infoField(o.category, 'value')) ?? '', is_remote: infojobsRemote(o) },
  };
}

type Fetcher = (query: string, timeoutMs: number, deadline?: number) => Promise<Candidate[]>;
const fetchers: Record<ApiProvider, (secret: string) => Fetcher> = {
  infojobs: secret => {
    const [id, key] = pairOf(secret); const auth = `Basic ${Buffer.from(`${id}:${key}`).toString('base64')}`;
    const get = async (path: string, timeoutMs: number) => json(await fetch(`${process.env.INFOJOBS_API_BASE ?? 'https://api.infojobs.net'}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: auth } }));
    return async (query, timeoutMs, deadline) => {
      const pages = intInRange(process.env.INFOJOBS_PAGES, INFOJOBS_PAGES, 1, 5);
      const offers = new Map<string, InfojobsOffer>();
      for (let page = 1; page <= pages; page++) {
        const data = await get(`/api/9/offer?${infojobsListParams(query, page)}`, timeoutMs);
        const batch: InfojobsOffer[] = Array.isArray(data.offers) ? data.offers : [];
        for (const offer of batch) if (infoString(offer.id) && infoString(offer.link)) offers.set(String(infoString(offer.id)), offer);
        // La respuesta dice cuántas páginas hay: no se pide una vacía por rutina.
        if (!batch.length || page >= (Number(data.totalPages) || 1)) break;
      }
      const base = [...offers.values()].map(offer => infojobsCandidate(offer));
      // La ficha cuesta una petición: solo para las que ya puntúan alto, que es donde el cuerpo decide.
      const top = intInRange(process.env.INFOJOBS_DETAIL_TOP, INFOJOBS_DETAIL_TOP, 0, 20);
      const ranked = top ? base
        .map(candidate => ({ candidate, score: enrich(candidate).score }))
        .filter(x => x.score >= INFOJOBS_DETAIL_MIN_SCORE)
        .sort((a, b) => b.score - a.score || (b.candidate.posted_at ?? '').localeCompare(a.candidate.posted_at ?? ''))
        .slice(0, top) : [];
      const details = new Map<string, InfojobsOffer>();
      let consecutiveFailures = 0;
      for (const { candidate } of ranked) {
        if (timeLeft(deadline) < MIN_STEP_MS || consecutiveFailures >= 2) break;
        try {
          details.set(candidate.external_id, await get(`/api/9/offer/${encodeURIComponent(candidate.external_id)}`, callTimeout(8000, deadline)));
          consecutiveFailures = 0;
        } catch { consecutiveFailures += 1; } // sin ficha se queda el listado: la oferta no se pierde
      }
      const byId = new Map(base.map(candidate => [candidate.external_id, candidate]));
      return ranked.length
        ? [...byId.values()].map(candidate => details.has(candidate.external_id) ? infojobsCandidate(offers.get(candidate.external_id) as InfojobsOffer, details.get(candidate.external_id)) : candidate)
        : base;
    };
  },
  adzuna: secret => {
    const [id, key] = pairOf(secret);
    return async (query, timeoutMs) => {
      const data = await json(await fetch(`${process.env.ADZUNA_API_BASE ?? 'https://api.adzuna.com'}/v1/api/jobs/es/search/1?app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}&results_per_page=50&max_days_old=10&sort_by=date&what=${encodeURIComponent(query)}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }));
      return (data.results ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        external_id: String(o.id), title: o.title, company: o.company?.display_name ?? null, location: o.location?.display_name ?? null, url: o.redirect_url,
        salary: money(o.salary_min, o.salary_max), posted_at: o.created ?? null, description: o.description ?? null, raw: { provider: 'adzuna', category: o.category?.label ?? '' },
      }));
    };
  },
  // Jooble emite una clave POR DOMINIO de país: la de jooble.org solo devuelve ofertas de EE. UU.
  // Para España hay que usar la clave de es.jooble.org y pegarle a ese dominio.
  jooble: secret => async (query, timeoutMs) => {
    const data = await json(await fetch(`${process.env.JOOBLE_API_BASE ?? 'https://es.jooble.org'}/api/${encodeURIComponent(secret)}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: query, location: 'España', page: 1, searchMode: 1 }) }));
    return (data.jobs ?? []).map((o: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      external_id: String(o.id ?? o.link), title: o.title, company: o.company ?? null, location: o.location ?? null, url: o.link,
      salary: o.salary || null, posted_at: o.updated ?? null, description: o.snippet ?? null, raw: { provider: 'jooble', job_type: o.type ?? '' },
    }));
  },
};

export type CollectOutcome = { provider: ApiProvider; ok: boolean; received?: number; accepted?: number; error?: string; truncated?: boolean };

// Recoge un proveedor con la clave guardada: una consulta tras otra, y un fallo de una no tumba las demás.
// Con `deadline` (presupuesto del cron) deja de lanzar consultas cuando no queda tiempo, guarda lo ya recogido y lo declara.
export async function collectProvider(provider: ApiProvider, via: string, deadline?: number): Promise<CollectOutcome> {
  try {
    const paused = await pausedSourcesStrict();
    if (!paused) return { provider, ok: false, error: 'No se pudo comprobar si la fuente está pausada; se reintenta en la próxima ejecución.' };
    if (paused.has(provider)) return { provider, ok: false, error: 'Fuente pausada' };
    const secret = await getSecret(provider as Provider);
    if (!secret) return { provider, ok: false, error: 'Sin clave guardada' };
    const fetchQuery = fetchers[provider](secret);
    const all: Candidate[] = []; const errors: string[] = []; let truncated = false;
    for (const query of QUERIES) {
      if (timeLeft(deadline) < MIN_STEP_MS) { truncated = true; break; }
      try { all.push(...await fetchQuery(query, callTimeout(20000, deadline), deadline)); } catch (err) { errors.push(`${query}: ${(err as Error).message}`); }
    }
    if (!all.length && errors.length) return { provider, ok: false, error: errors[0], truncated: truncated || undefined };
    if (!all.length && truncated) return { provider, ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', truncated: true };
    const notes = [errors.length ? `${errors.length} consulta(s) fallaron` : '', truncated ? 'cortada por presupuesto de tiempo' : ''].filter(Boolean).join(' · ') || undefined;
    const result = await ingest(provider, via, all, notes);
    return { provider, ok: true, received: result.received, accepted: result.accepted, truncated: truncated || undefined };
  } catch (err) { return { provider, ok: false, error: (err as Error).message }; }
}

// Reparte el tiempo que queda a partes iguales entre los proveedores que faltan: uno lento no deja sin hueco a los demás.
export async function collectAll(via: string, only?: ApiProvider, deadline?: number): Promise<CollectOutcome[]> {
  const list = only ? [only] : [...API_PROVIDERS];
  const outcomes: CollectOutcome[] = [];
  for (let i = 0; i < list.length; i++) {
    const share = deadline === undefined ? undefined : Date.now() + Math.max(0, timeLeft(deadline)) / (list.length - i);
    if (timeLeft(deadline) < MIN_STEP_MS) { outcomes.push({ provider: list[i], ok: false, error: 'Sin tiempo en el presupuesto del cron: se reintentará en la próxima ejecución.', truncated: true }); continue; }
    outcomes.push(await collectProvider(list[i], via, share));
  }
  return outcomes;
}
