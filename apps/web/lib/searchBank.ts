// Banco de términos y búsquedas: UNA fuente de verdad sobre «cómo se busca una oferta de closer, setter o cold calling»,
// independiente del buscador que la use (Apify, Bright Data, SerpApi, Tavily, RapidAPI, un portal con API oficial…).
// Módulo puro: sin red, sin Supabase, sin variables de entorno.
//
// Qué aporta (y qué no):
//  - TÉRMINOS por perfil × idioma, ordenados de lo más seguro a lo más amplio, y los de proyecto freelance.
//  - NEGATIVOS: palabras que se parecen pero no son el puesto («cerrajero», «closer to»…). Sirven para excluir en el
//    buscador (`-cerrajero`) y para descartar candidatos antes de guardarlos.
//  - MERCADOS: país, ubicación, idioma y `gl`. Un mismo término se pide con la ubicación correcta de cada mercado.
//  - FILTROS de fecha traducidos al formato de cada motor (Apify/LinkedIn, Tavily, Google `tbs`).
//  - CONSULTAS por motor: palabra clave, OR, Google con `site:` y semántica (frase natural para buscadores con IA).
//  - PLAN diario determinista: cada día toca todos los perfiles, rotando el término; una ejecución = una búsqueda.
// No inventa ofertas ni sueldos: solo dice QUÉ pedir. Lo que vuelva sigue pasando por `ingest` y la revisión.

import { fold, hasWord, roleFromTitle } from './vocabulary';

export type Lang = 'es' | 'en' | 'pt';
export type SearchRole = 'closer' | 'setter' | 'cold_caller';
export const SEARCH_ROLES: readonly SearchRole[] = ['closer', 'setter', 'cold_caller'];
export type Channel = 'board' | 'freelance';
export type Engine = 'keyword' | 'or' | 'google' | 'semantic';
export type Depth = 'core' | 'variants' | 'longtail';

type Tier = { core: string[]; variants: string[]; longtail: string[] };

/**
 * Términos de EMPLEO. `core` = lo que más ofertas reales trae; `variants` = sinónimos del mercado; `longtail` = formas
 * más raras que solo compensan en motores baratos. Los de empleo en español e inglés los clasifica `roleFromTitle` en su
 * perfil (lo prueba `searchbank.mjs`): un término que el clasificador no reconociera traería ofertas que luego no se verían.
 * «telemarketer» y «outbound caller» NO están a propósito: el vocabulario compartido con el motor no los reconoce.
 */
export const JOB_TERMS: Record<SearchRole, Record<Lang, Tier>> = {
  closer: {
    es: { core: ['closer de ventas', 'closer high ticket', 'closer'], variants: ['cerrador de ventas', 'closer remoto', 'closer comercial', 'especialista en cierre', 'asesor de admisiones'], longtail: ['cierre de ventas', 'closer b2b', 'closer senior', 'venta consultiva'] },
    en: { core: ['sales closer', 'high ticket closer', 'remote closer'], variants: ['closing specialist', 'enrollment advisor', 'admissions advisor'], longtail: ['closer b2c', 'full cycle sales', 'consultative sales'] },
    pt: { core: ['closer de vendas'], variants: [], longtail: [] },
  },
  setter: {
    es: { core: ['setter de ventas', 'appointment setter', 'setter'], variants: ['agendador de citas', 'concertador de citas', 'captador de leads', 'cualificador de leads'], longtail: ['setter digital', 'setter b2b', 'generador de citas'] },
    en: { core: ['appointment setter', 'sales setter', 'high ticket setter'], variants: ['lead qualifier', 'appointment booker', 'business development representative'], longtail: ['lead generation specialist'] },
    pt: { core: ['agendador de reunioes'], variants: [], longtail: [] },
  },
  cold_caller: {
    es: { core: ['cold calling', 'televenta', 'teleoperador comercial'], variants: ['cold caller', 'llamadas en frio', 'prospeccion telefonica', 'operador telefonico'], longtail: ['teleoperadora comercial', 'televentas'] },
    en: { core: ['cold caller', 'cold calling'], variants: [], longtail: [] },
    pt: { core: ['televendas'], variants: [], longtail: [] },
  },
};

/**
 * Términos de PROYECTO freelance (Upwork, Workana, Freelancer…): el cliente no publica un «puesto» sino un encargo,
 * así que entran formas que un empleo no llevaría («appointment setting», «book sales calls»).
 */
export const FREELANCE_TERMS: Record<SearchRole, Record<Lang, string[]>> = {
  closer: { es: ['closer de ventas', 'cierre de ventas', 'closer high ticket', 'cerrador de ventas'], en: ['sales closer', 'high ticket closer', 'closer for sales calls'], pt: ['closer de vendas'] },
  setter: { es: ['setter de ventas', 'agendador de citas', 'appointment setter'], en: ['appointment setter', 'appointment setting', 'book sales calls'], pt: ['agendador de reunioes'] },
  cold_caller: { es: ['cold calling', 'llamadas en frio', 'televenta'], en: ['cold caller', 'cold calling', 'outbound calls', 'cold caller remote'], pt: ['televendas'] },
};

/**
 * Cosas que se parecen a un puesto pero no lo son. `hasWord` exige palabra completa. Dos usos: `-término` en el
 * buscador (solo los de una palabra) y descarte previo del candidato.
 */
export const NEGATIVE_TERMS: readonly string[] = [
  'cerrajero', 'cerrajeria', 'locksmith', 'cerradura', 'closer to', 'closer look', 'closet', 'close up',
  'closing costs', 'closing ceremony', 'cierre contable', 'cierre de obra', 'cierre mensual', 'cierre fiscal',
];
const SINGLE_WORD_NEGATIVES = NEGATIVE_TERMS.filter(term => !term.includes(' '));

/** ¿El título o el resumen apunta a algo que no es el puesto? Devuelve el término que lo delata, o `null`. */
export function hitsNegative(text: string | null | undefined): string | null {
  const t = fold(text);
  return NEGATIVE_TERMS.find(term => hasWord(t, term)) ?? null;
}

export type Market = {
  id: string;
  label: string;
  /** Código ISO de país en mayúsculas (Indeed, Jooble). */
  country: string;
  /** Ubicación en texto para buscadores que la piden así. */
  location: string;
  lang: Lang;
  /** `gl` de Google. */
  gl: string;
  /** Nombre del país para Tavily (`country`), en inglés y minúsculas. */
  tavily: string;
};
export const MARKETS: Record<string, Market> = {
  es: { id: 'es', label: 'España', country: 'ES', location: 'España', lang: 'es', gl: 'es', tavily: 'spain' },
  mx: { id: 'mx', label: 'México', country: 'MX', location: 'México', lang: 'es', gl: 'mx', tavily: 'mexico' },
  co: { id: 'co', label: 'Colombia', country: 'CO', location: 'Colombia', lang: 'es', gl: 'co', tavily: 'colombia' },
  ar: { id: 'ar', label: 'Argentina', country: 'AR', location: 'Argentina', lang: 'es', gl: 'ar', tavily: 'argentina' },
  cl: { id: 'cl', label: 'Chile', country: 'CL', location: 'Chile', lang: 'es', gl: 'cl', tavily: 'chile' },
  pe: { id: 'pe', label: 'Perú', country: 'PE', location: 'Perú', lang: 'es', gl: 'pe', tavily: 'peru' },
  remote: { id: 'remote', label: 'Remoto (inglés)', country: 'US', location: 'Remote', lang: 'en', gl: 'us', tavily: 'united states' },
};
export const DEFAULT_MARKET = MARKETS.es;

/** Idioma probable de una fuente por su código. Por defecto español; lo anglosajón y lo portugués se listan aquí. */
const EN_SOURCES = /(?:^|-)(?:upwork|freelancer|simplyhired|glassdoor|remoteok|weworkremotely|wellfound|flexjobs|himalayas|ziprecruiter|monster|jobspy|remote|workingnomads|angellist)(?:-|$)/;
const PT_SOURCES = /(?:^|-)(?:catho|vagas|gupy|trabalhabrasil|99freelas)(?:-|$)/;
export function langOfSource(source: string): Lang {
  const code = source.toLowerCase().replace(/^apify-/, '');
  if (PT_SOURCES.test(code)) return 'pt';
  if (EN_SOURCES.test(code)) return 'en';
  return 'es';
}
const FREELANCE_SOURCES_RE = /(?:^|-)(?:upwork|workana|freelancer|99freelas)(?:-|$)/;
export const channelOfSource = (source: string): Channel => (FREELANCE_SOURCES_RE.test(source.toLowerCase().replace(/^apify-/, '')) ? 'freelance' : 'board');

const uniq = <T,>(list: T[]) => [...new Set(list)];

/** Términos de un perfil en un idioma, de lo más seguro a lo más amplio. `depth` limita hasta dónde se baja. */
export function termsFor(role: SearchRole, lang: Lang, channel: Channel = 'board', depth: Depth = 'variants'): string[] {
  if (channel === 'freelance') return uniq(FREELANCE_TERMS[role][lang]);
  const tier = JOB_TERMS[role][lang];
  return uniq([...tier.core, ...(depth === 'core' ? [] : tier.variants), ...(depth === 'longtail' ? tier.longtail : [])]);
}

/** Lista de rotación de un idioma: los perfiles se intercalan (closer, setter, cold calling, closer…) para que cada día cambie de perfil. */
export function rotationList(lang: Lang, channel: Channel = 'board', depth: Depth = 'variants'): Array<{ term: string; role: SearchRole }> {
  const lists = SEARCH_ROLES.map(role => termsFor(role, lang, channel, depth).map(term => ({ term, role })));
  const out: Array<{ term: string; role: SearchRole }> = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some(list => i < list.length); i++) {
    for (const list of lists) {
      const item = list[i];
      if (item && !seen.has(item.term)) { seen.add(item.term); out.push(item); }
    }
  }
  return out;
}

export const dayOf = (now = Date.now()) => Math.floor(now / 86_400_000);

export type PlannedSearch = { term: string; role: SearchRole; lang: Lang; market: Market; channel: Channel };
/**
 * Plan determinista del día: `count` búsquedas distintas, rotando por día UTC y cubriendo perfiles distintos antes de
 * repetir. Mismo día y mismas entradas dan siempre el mismo plan (sin azar: es reproducible y auditable).
 */
export function planSearches(options: { now?: number; count?: number; market?: Market; channel?: Channel; depth?: Depth } = {}): PlannedSearch[] {
  const { now = Date.now(), count = 3, channel = 'board', depth = 'variants', market = DEFAULT_MARKET } = options;
  const list = rotationList(market.lang, channel, depth);
  if (!list.length) return [];
  const take = Math.min(Math.max(1, Math.floor(count)), list.length);
  const start = (dayOf(now) * take) % list.length;
  return Array.from({ length: take }, (_, i) => ({ ...list[(start + i) % list.length], lang: market.lang, market, channel }));
}

/**
 * Términos de rotación para una fuente que no trae lista propia: perfiles intercalados, en el idioma y el canal de la
 * fuente. `firstTerm` (el que la fuente ya usaba) va primero para no cambiar su búsqueda de siempre.
 */
export function rotationTermsForSource(source: string, firstTerm?: string, max = 8): string[] {
  const terms = rotationList(langOfSource(source), channelOfSource(source), 'variants').map(item => item.term);
  return uniq([...(firstTerm ? [firstTerm] : []), ...terms]).slice(0, max);
}

// ── Filtros de fecha ─────────────────────────────────────────────────────────────────────────────────────────────────
export type DateWindow = 'day' | 'week' | 'month';
export const DATE_WINDOWS: Record<DateWindow, { days: number; linkedin: string; tavily: 'day' | 'week' | 'month'; googleTbs: string }> = {
  day: { days: 1, linkedin: 'r86400', tavily: 'day', googleTbs: 'qdr:d' },
  week: { days: 7, linkedin: 'r604800', tavily: 'week', googleTbs: 'qdr:w' },
  month: { days: 30, linkedin: 'r2592000', tavily: 'month', googleTbs: 'qdr:m' },
};

// ── Consultas por motor ──────────────────────────────────────────────────────────────────────────────────────────────
const quote = (term: string) => (/\s/.test(term) ? `"${term}"` : term);

/**
 * Una misma intención, escrita como la entiende cada motor:
 *  - keyword: el término tal cual (portales y actores con campo de búsqueda).
 *  - or: varios términos alternativos (`"a" OR "b"`), para motores que aceptan booleanos.
 *  - google: acotada a un sitio, con comillas y los negativos de una palabra (`-cerrajero`).
 *  - semantic: frase natural para buscadores con IA (Tavily), con ubicación y la intención de «oferta de empleo».
 */
export function buildQuery(engine: Engine, terms: string | string[], options: { site?: string; market?: Market; channel?: Channel } = {}): string {
  const list = Array.isArray(terms) ? terms : [terms];
  const market = options.market ?? DEFAULT_MARKET;
  if (!list.length) return '';
  if (engine === 'keyword') return list[0];
  if (engine === 'or') return list.slice(0, 4).map(quote).join(' OR ');
  if (engine === 'google') {
    const body = list.length > 1 ? `(${list.slice(0, 3).map(quote).join(' OR ')})` : quote(list[0]);
    return [options.site ? `site:${options.site}` : '', body, ...SINGLE_WORD_NEGATIVES.slice(0, 2).map(n => `-${n}`)].filter(Boolean).join(' ');
  }
  const what = options.channel === 'freelance'
    ? (market.lang === 'en' ? 'freelance project' : market.lang === 'pt' ? 'projeto freelance' : 'proyecto freelance')
    : (market.lang === 'en' ? 'job opening' : market.lang === 'pt' ? 'vaga de emprego' : 'oferta de empleo');
  return `${what} ${list[0]} ${market.lang === 'en' ? 'in' : 'en'} ${market.location}`;
}

/** Perfil que el clasificador da a un término (para comprobar la coherencia del banco). */
export const termRole = (term: string) => roleFromTitle(term);
