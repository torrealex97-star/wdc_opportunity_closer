// Tope y contabilidad de los proveedores que cobran por petición y NO son Apify.
//
// Apify tenía su propio tope mensual (`paid_budget`, editable en el panel). Bright Data, SerpApi y los
// proxys de HTML no lo tenían: este módulo les da un tope por variable de entorno, un formato de nota
// único y un lector que suma lo ya registrado. El tope sale de `provider_budget` por organización
// (`providerBudgetStore.readCaps`, una sola consulta) y, si la tabla no se puede leer o no tiene la fila,
// del entorno con `capUsd`. Cuando cae al entorno, se declara el motivo; no se inventa un tope.
//
// Un hueco no es un cero: sin tope legible o sin notas, el gasto devuelve `null` y el panel lo declara.

export type MeteredProvider = 'brightdata' | 'jsearch' | 'rapidapi' | 'serpapi' | 'zenrows' | 'scrapingbee' | 'tavily';

/** Inicio del mes en UTC, que es como se guardan `created_at` y como se compara el gasto. */
export const monthStart = (now = new Date()): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

export type ProviderMeter = {
  env: string;
  defaultUsd: number;
  usdPerRequest: number;
  note: string;
};

export const PROVIDER_METERS: Record<MeteredProvider, ProviderMeter> = {
  brightdata: {
    env: 'BRIGHTDATA_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.0015,
    note: '1,50 USD por 1.000 peticiones correctas · 5.000 créditos gratis al mes compartidos entre sus APIs',
  },
  jsearch: {
    env: 'JSEARCH_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.0025,
    note: '25 USD por 10.000 peticiones (0,0025 por página de hasta 10 ofertas); el plan gratuito incluye 200 al mes',
  },
  rapidapi: {
    env: 'RAPIDAPI_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.005,
    note: 'Estimación prudente: cada API de RapidAPI cobra según su plan (muchas tienen plan gratuito con cuota)',
  },
  serpapi: {
    env: 'SERPAPI_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.025,
    note: 'Unas 0,025 USD por búsqueda; el plan gratuito incluye 250 búsquedas al mes',
  },
  tavily: {
    env: 'TAVILY_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.008,
    note: '1 crédito por búsqueda básica (0,008 USD de pago por uso); el plan gratuito incluye 1.000 créditos al mes',
  },
  zenrows: {
    env: 'ZENROWS_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.002,
    note: 'Se paga por página entregada; el precio exacto depende del plan contratado',
  },
  scrapingbee: {
    env: 'SCRAPINGBEE_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.002,
    note: 'Se paga por crédito consumido; el precio exacto depende del plan contratado',
  },
};

export type CapSource = 'tabla' | 'entorno' | 'defecto';
/** Tope efectivo y de dónde sale: la tabla del panel, la variable de entorno o el defecto del proveedor. */
export type Cap = { usd: number; source: CapSource; error: string | null; /** Quién guardó el tope desde el panel (solo `tabla`). */ updated_by?: string | null; updated_at?: string | null };

/**
 * Importe válido para un tope: 0–5.000 USD, el mismo rango que el `CHECK` de `provider_budget`. Se distingue
 * de `parseMonthlyUsd` (Apify, 1–5.000) en que el 0 es válido: «en este proveedor no se gasta».
 */
export function parseCapUsd(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const usd = Math.round(n * 100) / 100;
  return usd >= 0 && usd <= 5000 ? usd : null;
}

/** Tope del entorno, o el defecto del proveedor si la variable no es un importe válido. */
export function envCap(provider: MeteredProvider, env: NodeJS.ProcessEnv = process.env): Cap {
  const usd = parseCapUsd(env[PROVIDER_METERS[provider].env]);
  return usd === null
    ? { usd: PROVIDER_METERS[provider].defaultUsd, source: 'defecto', error: null }
    : { usd, source: 'entorno', error: null };
}

/** Respaldo puro: el tope del entorno. En servidor, el efectivo lo resuelve `providerBudgetStore`. */
export function capUsd(provider: MeteredProvider, env: NodeJS.ProcessEnv = process.env): number {
  return envCap(provider, env).usd;
}

/**
 * Tope efectivo a partir de la fila de `provider_budget` (o de su ausencia), con el entorno como respaldo.
 * Puro: lo usa el lector de BD y lo prueban los tests sin red.
 */
export function capFromRow(provider: MeteredProvider, row: { monthly_usd?: unknown } | null | undefined, env: NodeJS.ProcessEnv = process.env): Cap {
  if (!row) return envCap(provider, env);
  const usd = parseCapUsd(row.monthly_usd);
  if (usd !== null) return { usd, source: 'tabla', error: null };
  const fallback = envCap(provider, env);
  return { ...fallback, error: `El tope guardado de ${provider} no es un importe válido; se usa el del entorno.` };
}

/** Coste anotado en una ejecución de ingesta: `coste_usd=0.0105`. */
export function costFromNote(note: string | null | undefined): number | null {
  if (!note) return null;
  const match = /coste_usd=([\d.]+)/.exec(note);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Suma lo registrado en las notas de las ejecuciones. `null` si no hay ninguna nota con coste (no es 0:
 * puede que el proveedor no lo anote). `partial` si alguna nota del proveedor no traía importe.
 */
export function spentFromNotes(notes: Array<{ vendor?: string | null; note?: string | null }>, provider: MeteredProvider): { usd: number | null; partial: boolean } {
  const mine = notes.filter(row => row.vendor === provider || (row.note ?? '').includes(`proveedor=${provider}`));
  if (!mine.length) return { usd: null, partial: false };
  let sum = 0;
  let partial = false;
  for (const row of mine) {
    const value = costFromNote(row.note);
    if (value === null) partial = true;
    else sum += value;
  }
  return { usd: Math.round(sum * 1e6) / 1e6, partial };
}

/** Peticiones anotadas por un proveedor (`3 petición(es)`); `null` si ninguna nota las trae. */
export function requestsFromNotes(notes: Array<{ vendor?: string | null; note?: string | null }>, provider: MeteredProvider): number | null {
  const mine = notes.filter(row => row.vendor === provider || (row.note ?? '').includes(`proveedor=${provider}`));
  let total = 0;
  let seen = false;
  for (const row of mine) {
    const match = /(\d+) petici[oó]n\(es\)/.exec(row.note ?? '');
    if (match) { total += Number(match[1]); seen = true; }
  }
  return seen ? total : null;
}

/** Nota única para `external_ingest_runs`: la lee el marcador y se lee a sí misma al calcular el tope. */
export function spendNote(input: { route: string; provider: MeteredProvider; requests: number; costUsd: number; detail?: string }): string {
  const parts = [
    `ruta ${input.route}`,
    `proveedor=${input.provider}`,
    `${input.requests} petición(es)`,
    `coste_usd=${input.costUsd.toFixed(6)}`,
    input.detail,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * ¿Queda dinero para lanzar? Sin tope legible no se lanza gasto nuevo. `requests` es el **peor caso**
 * de peticiones que puede hacer la llamada (por ejemplo 2 si reintenta una vez): se reserva entero para
 * que un reintento no pueda dejar el gasto por encima del tope.
 */
export function canSpend(provider: MeteredProvider, spentUsd: number | null, env: NodeJS.ProcessEnv = process.env, requests = 1, capOverride?: number): { ok: boolean; reason?: string; cap: number; spent: number | null } {
  // `capOverride` es el tope de la organización (ya resuelto con la tabla); sin él, el del entorno.
  const cap = capOverride ?? capUsd(provider, env);
  if (cap <= 0) return { ok: false, reason: 'El tope mensual de este proveedor es 0: no se lanza nada.', cap, spent: spentUsd };
  if (spentUsd === null) return { ok: false, reason: 'No se pudo leer lo gastado este mes; por seguridad no se lanza gasto nuevo.', cap, spent: null };
  const worstCase = PROVIDER_METERS[provider].usdPerRequest * Math.max(1, requests);
  if (spentUsd + worstCase > cap) {
    return { ok: false, reason: `Quedan ${Math.max(0, cap - spentUsd).toFixed(2)} USD de ${cap} USD este mes.`, cap, spent: spentUsd };
  }
  return { ok: true, cap, spent: spentUsd };
}
