// Tope y contabilidad de los proveedores que cobran por petición y NO son Apify.
//
// Apify tenía su propio tope mensual (`paid_budget`, editable en el panel). Bright Data, SerpApi y los
// proxys de HTML tienen el suyo: el que el propietario guarda en `provider_budget` desde Panel → APIs
// (`providerCaps.ts`), con la variable de entorno y el valor por defecto como respaldo. Este módulo da el
// formato único de nota, el lector que suma lo ya registrado y `canSpend`, al que se le pasa el tope efectivo.
//
// Un hueco no es un cero: sin tope legible o sin notas, el gasto devuelve `null` y el panel lo declara.

export type MeteredProvider = 'brightdata' | 'serpapi' | 'zenrows' | 'scrapingbee';

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
  serpapi: {
    env: 'SERPAPI_MONTHLY_USD',
    defaultUsd: 5,
    usdPerRequest: 0.025,
    note: 'Unas 0,025 USD por búsqueda; el plan gratuito incluye 250 búsquedas al mes',
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

export function capUsd(provider: MeteredProvider, env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env[PROVIDER_METERS[provider].env]);
  return Number.isFinite(raw) && raw >= 0 && raw <= 5000 ? raw : PROVIDER_METERS[provider].defaultUsd;
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

/** ¿Queda dinero para una petición más? Sin tope legible no se lanza gasto nuevo. */
export function canSpend(provider: MeteredProvider, spentUsd: number | null, env: NodeJS.ProcessEnv = process.env, capOverride?: number, requests = 1): { ok: boolean; reason?: string; cap: number; spent: number | null } {
  // `capOverride` es el tope guardado en `provider_budget` (el que fija el propietario en el panel); sin él
  // manda la variable de entorno y, sin ella, el valor por defecto.
  const cap = capOverride !== undefined && Number.isFinite(capOverride) && capOverride >= 0 ? capOverride : capUsd(provider, env);
  if (cap <= 0) return { ok: false, reason: 'El tope mensual de este proveedor es 0: no se lanza nada.', cap, spent: spentUsd };
  if (spentUsd === null) return { ok: false, reason: 'No se pudo leer lo gastado este mes; por seguridad no se lanza gasto nuevo.', cap, spent: null };
  if (spentUsd + PROVIDER_METERS[provider].usdPerRequest * Math.max(1, requests) > cap) {
    return { ok: false, reason: `Quedan ${Math.max(0, cap - spentUsd).toFixed(2)} USD de ${cap} USD este mes.`, cap, spent: spentUsd };
  }
  return { ok: true, cap, spent: spentUsd };
}

/** Coste estimado antes de lanzar: peticiones × precio unitario del proveedor. */
export const estimateUsd = (provider: MeteredProvider, requests: number) =>
  Math.round(requests * PROVIDER_METERS[provider].usdPerRequest * 1e6) / 1e6;
