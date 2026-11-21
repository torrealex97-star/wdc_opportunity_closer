// Rutas por fuente: el modelo que decide, en orden y por coste, por dónde se intenta cada fuente.
//
// Una fuente no tiene «un proveedor»: tiene varias vías. Esto las hace explícitas para que el panel las
// enseñe y para que la cascada no dependa de la marca sino del coste y de lo que esté configurado:
//
//   1. API/feed oficial gratis (motor, backend, ATS)        0
//   2. API oficial con clave (InfoJobs, Adzuna, Jooble)     0 con cuota
//   3. Google Jobs vía Bright Data SERP                     0,0015 USD/búsqueda
//   4. Google Jobs vía SerpApi                              0,025 USD/búsqueda
//   5. Apify                                                pago por resultado
//   6. JobSpy                                              0, pero solo con proxies sanos y al final
//   7. Web Unlocker / ZenRows / ScrapingBee                 ~0,0015–0,002 USD/página
//   8. Hermes / Manus                                       no disponibles (ADR-009)
//
// Módulo puro: no importa clientes de red, Supabase ni variables de entorno. Lo usan el panel (cliente)
// y las rutas de API (servidor), y las pruebas lo ejecutan tal cual. Sin clave no hay ruta «conectada»:
// la disponibilidad se calcula con las claves que el operador ya guardó, nunca se supone.

import { PORTALS } from './apifyCatalog';
import { PROVIDER_METERS } from './providerBudget';

export type RouteProvider = 'engine' | 'backend' | 'official' | 'brightdata' | 'serpapi' | 'apify' | 'jobspy' | 'unlocker' | 'agent';
export type RouteCost = 'free' | 'quota' | 'metered' | 'paid' | 'unavailable';
export type RouteEvidence = 'operativo' | 'medido' | 'documentado' | 'bloqueado' | 'no_disponible';

export type SourceRoute = {
  /** `fuente:proveedor`, estable: se usa para probar una ruta concreta desde el panel. */
  id: string;
  source: string;
  provider: RouteProvider;
  label: string;
  cost: RouteCost;
  /** Coste unitario cuando se conoce (USD); `null` si es variable o no hay tarifa pública verificada. */
  costUsd: number | null;
  /** Qué hace falta para que esta ruta se pueda lanzar. */
  requirement: string;
  detail: string;
  /** Orden de la cascada: menor se intenta antes. JobSpy siempre después de Apify. */
  stage: number;
  evidence: RouteEvidence;
  evidenceNote: string;
  checkedAt: string;
  /** Clave o condición que debe existir para considerarla conectada. */
  requiresKey?: string;
  /** Varias claves alternativas: la vía se puede lanzar con cualquiera de ellas (p. ej. Unlocker). */
  requiresAnyKey?: string[];
  /** Los resultados llegan después de lanzar el actor (Apify), no en la misma respuesta. */
  async?: boolean;
};

export type CatalogLite = {
  code: string;
  name: string;
  website?: string | null;
  requires?: string | null;
  acquisition_method?: string | null;
  category?: string | null;
};

export const ROUTE_STAGE: Record<RouteProvider, number> = {
  engine: 0,
  backend: 0,
  official: 1,
  brightdata: 2,
  serpapi: 3,
  apify: 4,
  jobspy: 5,
  unlocker: 6,
  agent: 7,
};

export const COST_LABEL: Record<RouteCost, string> = {
  free: 'Gratis',
  quota: 'Cuota gratis',
  metered: 'Metrado',
  paid: 'Pago por resultado',
  unavailable: 'No disponible',
};

export const EVIDENCE_LABEL: Record<RouteEvidence, string> = {
  operativo: 'Operativa',
  medido: 'Medida',
  documentado: 'Documentada · sin probar',
  bloqueado: 'Bloqueada',
  no_disponible: 'No disponible',
};

const CHECKED = '2026-11-21';
const DEAD_FEEDS = new Set(['remotejobs', 'remotefirstjobs']);
const OFFICIAL_KEYS: Record<string, string> = { infojobs: 'infojobs', adzuna: 'adzuna', jooble: 'jooble' };
const JOBSPY_SOURCES = new Set(['indeed', 'linkedin', 'glassdoor', 'google']);
const HTML_EXTRACTOR = new Set(['company', 'custom']);

/** Los 9 portales con respaldo ya escrito en `serpapiFallback.ts`; el resto solo va por Bright Data. */
const SERPAPI_SOURCES = new Set(['google', 'infojobs', 'indeed', 'linkedin', 'computrabajo', 'occ-mundial', 'laborum', 'bumeran', 'bebee', 'jooble', 'adzuna']);
const APIFY_PORTALS = new Set(PORTALS.map(portal => portal.source));

const hostOf = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};

const clip = (value: string, max = 300) => value.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Todas las rutas posibles de una fuente del catálogo. No decide si están conectadas: eso es
 * `routeReadiness`, con las claves reales. Aquí solo se declara qué vías existen y cuánto cuestan.
 */
export function routesForSource(entry: CatalogLite): SourceRoute[] {
  const routes: SourceRoute[] = [];
  const code = entry.code;
  const base = { source: code, checkedAt: CHECKED };
  const add = (route: Omit<SourceRoute, 'id' | 'source' | 'checkedAt'>) => {
    routes.push({ ...base, ...route, id: `${code}:${route.provider}` });
  };

  if (DEAD_FEEDS.has(code)) {
    add({
      provider: 'engine', label: 'Feed público', cost: 'free', costUsd: 0, stage: 0,
      requirement: 'Nada; pero el feed lleva tiempo caído.',
      detail: 'El conector existe, pero el origen respondió 404/410 en la última comprobación. No se presenta como operativo.',
      evidence: 'bloqueado', evidenceNote: 'Feed caído: se declara y no se reintenta a ciegas.',
    });
  } else if (entry.requires === 'none') {
    add({
      provider: 'engine',
      label: code.startsWith('ats-') ? 'Feed ATS público' : 'API o feed público',
      cost: 'free', costUsd: 0, stage: 0,
      requirement: 'Nada: ya se recoge sin clave.',
      detail: code.startsWith('ats-')
        ? 'Bolsa pública del ATS (Greenhouse, Ashby, Teamtailor, Recruitee, Lever o SmartRecruiters). Una petición por empresa y pasada.'
        : 'Conector del motor o feed público. Se recoge en cada pasada sin clave ni coste por petición.',
      evidence: 'operativo',
      evidenceNote: 'Conector en producción del motor.',
    });
  }

  const officialKey = OFFICIAL_KEYS[code];
  if (officialKey) {
    add({
      provider: 'official', label: `API oficial de ${entry.name}`, cost: 'quota', costUsd: 0, stage: 1,
      requirement: `Clave de ${entry.name} en Panel → APIs.`,
      detail: 'API del propio portal. Sin clave no hay llamada; con clave entra dentro de la cuota del plan.',
      evidence: 'documentado', evidenceNote: 'Documentación oficial revisada; la clave y la primera llamada las validas tú.',
      requiresKey: officialKey,
    });
  }

  const host = hostOf(entry.website);
  const googleQuery = code === 'google' ? 'closer de ventas España' : host ? `site:${host} closer de ventas` : null;
  if (googleQuery) {
    add({
      provider: 'brightdata', label: 'Google Jobs · Bright Data', cost: 'metered', costUsd: 0.0015, stage: 2,
      requirement: 'API key y zona SERP de Bright Data (formato API key:zona).',
      detail: `Una búsqueda de Google Jobs con \`ibp=htl;jobs\` (${googleQuery}). Cuesta 1/16 que SerpApi y comparte los 5.000 créditos gratis del mes.`,
      evidence: 'documentado', evidenceNote: 'Contrato y precio verificados en su documentación; sin clave aquí, se prueba con fixture.',
      requiresKey: 'brightdata',
    });
  }
  if (googleQuery && SERPAPI_SOURCES.has(code)) {
    add({
      provider: 'serpapi', label: 'Google Jobs · SerpApi', cost: 'metered', costUsd: 0.025, stage: 3,
      requirement: 'API key de SerpApi en Panel → APIs.',
      detail: 'Respaldo cuando no hay Bright Data. Misma búsqueda, 0,025 USD por búsqueda y sin paginación.',
      evidence: 'documentado', evidenceNote: 'Usado ya por el motor; el coste se anota en la nota de cada ejecución.',
      requiresKey: 'serpapi',
    });
  }

  if (APIFY_PORTALS.has(`apify-${code}`) || APIFY_PORTALS.has(code)) {
    add({
      provider: 'apify', label: 'Actor de Apify', cost: 'paid', costUsd: null, stage: 4,
      requirement: 'Token de Apify y presupuesto mensual con saldo.',
      detail: 'Se lanza un actor auditado para este portal. Se paga por resultado y los datos llegan después del lanzamiento; nunca se da por hecho.',
      evidence: 'documentado', evidenceNote: 'Actores con metadatos revisados; la extracción se valida al lanzar.',
      requiresKey: 'apify', async: true,
    });
  }

  if (JOBSPY_SOURCES.has(code)) {
    add({
      provider: 'jobspy', label: 'JobSpy · GitHub Actions', cost: 'free', costUsd: 0, stage: 5,
      requirement: 'Proxies sanos en JOBSPY_PROXIES (200 en menos de 8 s). Sin ninguno, no se lanza.',
      detail: 'Última vía sin coste directo. Se ejecuta fuera del servidor y solo con proxies validados; sin proxies se declara y no se intenta.',
      evidence: 'documentado', evidenceNote: 'Script y workflow del repo; depende de proxies que no están en este entorno.',
      requiresKey: 'jobspy',
    });
  }

  if (HTML_EXTRACTOR.has(code) && host) {
    add({
      provider: 'unlocker', label: 'Web Unlocker + extractor', cost: 'metered', costUsd: 0.0015, stage: 6,
      requirement: 'Zona Web Unlocker de Bright Data, o clave de ZenRows/ScrapingBee.',
      detail: 'Descarga el HTML y aplica el extractor común (JSON-LD JobPosting o RSS). No se usa en portales sin extractor probado.',
      evidence: 'documentado', evidenceNote: 'Extractor probado con fixtures; la lectura real exige clave y una URL con JSON-LD o RSS.',
      requiresAnyKey: ['brightdata', 'zenrows', 'scrapingbee'],
    });
  }

  return routes.sort((a, b) => a.stage - b.stage || a.label.localeCompare(b.label, 'es'));
}

export function routesForCatalog(catalog: CatalogLite[]): Map<string, SourceRoute[]> {
  return new Map(catalog.map(entry => [entry.code, routesForSource(entry)]));
}

/** Vías que nunca se adelantan: JobSpy y el hueco agéntico van siempre al final. */
const PINNED_LAST = new Set<RouteProvider>(['jobspy', 'agent']);

/**
 * Orden efectivo de una fuente. Sin `order` manda el coste (stage). Con `order` (ids de ruta), esas
 * rutas van primero en el orden pedido; las que no se listan conservan su stage. JobSpy y el agente
 * quedan siempre al final aunque el override los intente mover: es la última vía por diseño.
 */
export function orderRoutes(routes: SourceRoute[], order: string[] = []): SourceRoute[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...routes].sort((a, b) => {
    const aPinned = PINNED_LAST.has(a.provider);
    const bPinned = PINNED_LAST.has(b.provider);
    if (aPinned !== bPinned) return aPinned ? 1 : -1;
    if (aPinned && bPinned) return a.stage - b.stage || a.label.localeCompare(b.label, 'es');
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);
    if (aRank !== undefined || bRank !== undefined) {
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      if (aRank !== bRank) return aRank - bRank;
    }
    return a.stage - b.stage || a.label.localeCompare(b.label, 'es');
  });
}

export type RouteState = {
  /** Claves guardadas por id de proveedor (`infojobs`, `brightdata`, `apify`…). */
  keys: Set<string>;
  paused: boolean;
  /** Saldo disponible este mes por proveedor; `null` = no se pudo leer, y entonces no se lanza gasto. */
  budget: Record<string, number | null>;
  /** Solo para JobSpy: hay al menos un proxy que respondió 200 en menos de 8 s. */
  proxiesHealthy: boolean;
  /** Bright Data tiene zona Unlocker; `undefined` = no comprobado (pruebas puras antiguas). */
  unlockerReady?: boolean;
};

export type Readiness = { ok: boolean; reason: string };

/**
 * Orden real de lanzamiento del extractor HTML. No es el mismo que el de presentación
 * (`requiresAnyKey`): ZenRows y ScrapingBee van antes que Bright Data, así que la disponibilidad y
 * el tope que se comprueban tienen que ser los DEL PROVEEDOR QUE SE LANZA, no los del primero que
 * tenga clave. Una sola función manda en el panel y en «Probar ruta».
 */
export const UNLOCKER_PROVIDERS = ['zenrows', 'scrapingbee', 'brightdata'] as const;
export type UnlockerKey = (typeof UNLOCKER_PROVIDERS)[number];
const UNLOCKER_ATTEMPTS = 2;

/** El primer proveedor con clave, zona (si es Bright Data) y saldo para el peor caso (2 intentos). */
export function unlockerProviderFor(state: RouteState): UnlockerKey | null {
  for (const key of UNLOCKER_PROVIDERS) {
    if (!state.keys.has(key)) continue;
    if (key === 'brightdata' && state.unlockerReady === false) continue;
    const left = state.budget[key];
    // El cliente de HTML reintenta una vez: se exige el peor caso, igual que `canSpend(..., 2)`.
    // Si no, el panel diría «lista» con 0,001 USD y el POST la rechazaría al reservar los dos intentos.
    if (left === null || left === undefined || left < PROVIDER_METERS[key].usdPerRequest * UNLOCKER_ATTEMPTS) continue;
    return key;
  }
  return null;
}

/** ¿Se puede lanzar esta ruta ahora? Sin clave o sin tope, se dice el motivo y no se intenta. */
export function routeReadiness(route: SourceRoute, state: RouteState): Readiness {
  if (state.paused) return { ok: false, reason: 'La fuente está pausada.' };
  if (route.evidence === 'bloqueado') return { ok: false, reason: route.evidenceNote };
  if (route.provider === 'agent') return { ok: false, reason: 'Hermes/Manus no están implementados (ADR-009).' };
  // JobSpy se llama «gratis» porque no cobra por petición, pero sin proxies sanos NO se lanza: la
  // condición va antes que el atajo de coste cero.
  if (route.provider === 'jobspy') {
    return state.proxiesHealthy ? { ok: true, reason: '' } : { ok: false, reason: 'Sin proxies sanos: no se intentó (JobSpy es la última vía).' };
  }
  if (route.cost === 'free') return { ok: true, reason: '' };
  if (route.requiresAnyKey?.length) {
    // La elección es la misma que usará el POST: así el panel no dice «lista» para un proveedor y
    // luego lanza otro con otro saldo. Bright Data solo entra si tiene la segunda zona.
    if (unlockerProviderFor(state)) return { ok: true, reason: '' };
    const candidates = route.requiresAnyKey.filter(key => state.keys.has(key));
    if (!candidates.length) {
      return { ok: false, reason: `Sin clave de ${route.requiresAnyKey.join(' ni ')}: no se intenta.` };
    }
    if (candidates.length === 1 && candidates[0] === 'brightdata' && state.unlockerReady === false) {
      return { ok: false, reason: 'La clave de Bright Data no incluye zona Unlocker: añádela como API key:zona SERP:zona Unlocker.' };
    }
    const unknown = candidates.filter(key => state.budget[key] === null || state.budget[key] === undefined);
    if (unknown.length) return { ok: false, reason: `No se pudo leer el gasto del mes de ${unknown.join(', ')}: por seguridad no se lanza.` };
    return { ok: false, reason: `Tope mensual agotado para ${candidates.join(', ')}: no se lanza.` };
  }
  if (!route.requiresKey) return { ok: true, reason: '' };
  if (!state.keys.has(route.requiresKey)) {
    return { ok: false, reason: `Sin clave de ${route.requiresKey}: no se intenta.` };
  }
  if (route.cost === 'metered' || route.cost === 'paid') {
    const left = state.budget[route.requiresKey];
    if (left === null || left === undefined) return { ok: false, reason: 'No se pudo leer el gasto del mes: por seguridad no se lanza.' };
    if (left <= 0) return { ok: false, reason: 'Tope mensual agotado: no se lanza.' };
  }
  return { ok: true, reason: '' };
}

export type CascadeStep = { route: SourceRoute; ready: boolean; reason: string };

/** La cascada completa, incluidos los pasos que se saltan y por qué (el panel los enseña). */
export function planCascade(routes: SourceRoute[], state: RouteState, order: string[] = []): CascadeStep[] {
  return orderRoutes(routes, order)
    .map(route => {
      const readiness = routeReadiness(route, state);
      return { route, ready: readiness.ok, reason: readiness.reason };
    });
}

export type CascadeResult = { route: SourceRoute; status: 'guardada' | 'vacía' | 'error' | 'lanzada' | 'omitida'; accepted: number; note: string };
export type CascadeExecution = { accepted: number; launched?: boolean; note?: string; error?: string };

/**
 * Ejecuta los pasos listos en orden y PARA en la primera ruta con ofertas (o en la primera que se lanza
 * de forma asíncrona, porque su resultado aún no se puede contar). Los pasos no listos se registran como
 * «omitida» con su motivo: una fuente caída nunca oculta las que sí trajeron.
 */
export async function runCascade(steps: CascadeStep[], execute: (route: SourceRoute) => Promise<CascadeExecution>): Promise<{ attempts: CascadeResult[]; winner: SourceRoute | null }> {
  const attempts: CascadeResult[] = [];
  let winner: SourceRoute | null = null;
  for (const step of steps) {
    if (!step.ready) { attempts.push({ route: step.route, status: 'omitida', accepted: 0, note: step.reason }); continue; }
    if (winner) { attempts.push({ route: step.route, status: 'omitida', accepted: 0, note: `No se intentó: ${winner.label} ya trajo ofertas.` }); continue; }
    try {
      const result = await execute(step.route);
      if (result.launched) {
        attempts.push({ route: step.route, status: 'lanzada', accepted: result.accepted, note: result.note ?? 'Lanzada; los resultados llegan después.' });
        winner = step.route;
      } else if (result.accepted > 0) {
        attempts.push({ route: step.route, status: 'guardada', accepted: result.accepted, note: result.note ?? `${result.accepted} guardada(s).` });
        winner = step.route;
      } else {
        attempts.push({ route: step.route, status: 'vacía', accepted: 0, note: result.note ?? 'Respondió sin ofertas: se prueba la siguiente.' });
      }
    } catch (err) {
      attempts.push({ route: step.route, status: 'error', accepted: 0, note: clip((err as Error).message) || 'Error sin detalle.' });
    }
  }
  return { attempts, winner };
}

/** Grupo del panel al que va una fuente, según sus vías y las claves ya guardadas. */
export type SourceGroup = 'direct' | 'keyed' | 'google' | 'apify' | 'other' | 'multi' | 'none';

export const GROUP_LABEL: Record<SourceGroup, string> = {
  direct: 'Directo, gratis',
  keyed: 'Tus APIs con clave',
  google: 'Google Jobs',
  apify: 'Apify',
  other: 'Otros proveedores',
  multi: 'Multi-vía',
  none: 'Sin proveedor verificado',
};

/**
 * Una vía gratuita cuenta como operativa solo si no está bloqueada y no es JobSpy: JobSpy no cobra
 * por petición, pero sin proxies sanos no se lanza. La agrupación y el KPI «Gratis y operativas»
 * comparten esta condición para que no vuelvan a divergir.
 */
export function hasFreeOperationalRoute(routes: SourceRoute[]): boolean {
  return routes.some(route => route.cost === 'free' && route.evidence !== 'bloqueado' && route.provider !== 'jobspy');
}

export function groupForSource(routes: SourceRoute[], keys: Set<string>): SourceGroup {
  // JobSpy no cobra por petición, pero sin proxies sanos no está listo: no convierte una fuente en
  // «Directo, gratis» ni la esconde del grupo que sí le toca (Google Jobs, Apify u otros).
  const free = hasFreeOperationalRoute(routes);
  const keyed = routes.some(route => ((route.requiresKey && keys.has(route.requiresKey)) || route.requiresAnyKey?.some(key => keys.has(key))) && route.provider !== 'engine' && route.provider !== 'backend');
  if (free && keyed) return 'multi';
  if (free) return 'direct';
  if (routes.some(route => route.provider === 'official')) return 'keyed';
  if (routes.some(route => route.provider === 'brightdata' || route.provider === 'serpapi')) return 'google';
  if (routes.some(route => route.provider === 'apify')) return 'apify';
  if (routes.some(route => route.provider === 'unlocker' || route.provider === 'jobspy')) return 'other';
  return 'none';
}

/** Hermes/Manus: insignia honesta; no hay ruta que se pueda lanzar. */
export const AGENT_GAP_FILL: SourceRoute = {
  id: 'agent:hermes-manus', source: 'agent', provider: 'agent', label: 'Hermes / Manus', cost: 'unavailable', costUsd: null,
  requirement: 'No disponible: falta el proveedor agéntico (ADR-009).',
  detail: 'Se reserva el hueco para rellenar lo que ninguna vía estructurada cubra. No se simula su estado ni se presenta como conectado.',
  stage: ROUTE_STAGE.agent, evidence: 'no_disponible', evidenceNote: 'ADR-009: no implementado.', checkedAt: CHECKED,
};
